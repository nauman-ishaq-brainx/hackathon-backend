import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import type { AiTicketDraft, TicketPriority, TicketType } from './ai-ticket.types';

const TICKETS_PROMPT_VERSION = 'tickets-v1';

const TICKET_TYPES = new Set<TicketType>(['Epic', 'Story', 'Task', 'Subtask']);
const PRIORITIES = new Set<TicketPriority>(['Low', 'Medium', 'High']);

/** Hard cap on clarifying questions returned from ambiguity analysis. */
const MAX_CLARIFYING_QUESTIONS = 7;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('OPENAI_API_KEY');
    this.client = key ? new OpenAI({ apiKey: key }) : null;
  }

  async findAmbiguities(rawBrief: string): Promise<string[]> {
    const text = await this.chatJsonObject([
      {
        role: 'system',
        content: `You help a PMO turn client briefs into developer-ready work.
Your ONLY task is to list the **most important** clarifying questions / ambiguities—things that would materially change scope, design, estimates, risk, or acceptance if misunderstood.

Focus on high-impact gaps only, for example:
- Contradictions or conflicting requirements
- Undefined actors, integrations, platforms, or environments
- Missing or untestable acceptance criteria for **core** user journeys
- Security, privacy, compliance, or data-handling unknowns when relevant
- Ambiguous timelines, SLAs, scale, or success metrics when they drive engineering choices

Do **NOT** include:
- Minor wording or stylistic preferences
- Nice-to-have polish unless the brief hinges on it
- Questions already clearly answered in the brief text

Rules:
- Do NOT invent requirements or facts not implied by the brief.
- Each item is one short, neutral clarifying question or gap statement (not solutions).
- Return **at most ${MAX_CLARIFYING_QUESTIONS}** items. Include **5–7** only when that many **distinct, material** issues exist; otherwise return fewer. If the brief is clear enough for planning, return [].
- Order the array **by descending importance** (index 0 = highest priority).
- Respond with JSON only, exactly: {"ambiguities": string[]}
- Every element of "ambiguities" must be a non-empty string.`,
      },
      { role: 'user', content: rawBrief },
    ]);

    try {
      const parsed = JSON.parse(text) as { ambiguities?: unknown };
      if (!Array.isArray(parsed.ambiguities)) {
        return [];
      }
      return parsed.ambiguities
        .filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
        .map((s) => s.trim())
        .slice(0, MAX_CLARIFYING_QUESTIONS);
    } catch {
      this.logger.warn('Failed to parse ambiguities JSON from model output');
      return [];
    }
  }

  /**
   * Builds Jira-style tickets from the original brief plus fully resolved ambiguities.
   */
  async generateTickets(input: {
    rawBrief: string;
    resolvedAmbiguities: { text: string; answer: string }[];
  }): Promise<AiTicketDraft[]> {
    const userPayload = JSON.stringify(
      {
        rawBrief: input.rawBrief,
        resolvedAmbiguities: input.resolvedAmbiguities,
      },
      null,
      2,
    );

    const text = await this.chatJsonObject([
      {
        role: 'system',
        content: `You are a senior PM / tech lead. Given a client brief and a list of ambiguities that have ALL been answered by the client, produce developer-ready work items.

Rules:
- Base tickets ONLY on the brief text plus the provided Q&A. Do not invent product scope beyond what is reasonably implied.
- Prefer a sensible hierarchy: Epics for large themes, Stories for user-facing slices, Tasks for engineering work, Subtasks only when truly dependent on a parent-sized item.
- "dependsOnIndices" MUST reference other tickets in your SAME "tickets" array using 0-based positions. Only use indices less than the current ticket index (no forward or self references). Use [] if none.
- Each ticket needs: title, type, description, acceptanceCriteria (array of testable strings), optional priority (Low|Medium|High), optional confidenceScore (0-1) for how well the brief supports that ticket.
- Respond with JSON only, exactly this shape:
{"tickets":[{"title":"string","type":"Epic"|"Story"|"Task"|"Subtask","description":"string","acceptanceCriteria":["string"],"dependsOnIndices":[0],"priority":"Medium","confidenceScore":0.75}]}
- "tickets" must be a non-empty array unless the brief truly has zero implementable work (then return {"tickets":[]}).`,
      },
      { role: 'user', content: userPayload },
    ]);

    let parsed: { tickets?: unknown };
    try {
      parsed = JSON.parse(text) as { tickets?: unknown };
    } catch {
      this.logger.warn('Failed to parse tickets JSON from model output');
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message:
            'The AI returned invalid data for tickets. Please try again later.',
          code: 'AI_INVALID_TICKETS_JSON',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!Array.isArray(parsed.tickets)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message:
            'The AI did not return a tickets array. Please try again later.',
          code: 'AI_INVALID_TICKETS_SHAPE',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return this.normalizeTicketDrafts(parsed.tickets);
  }

  private normalizeTicketDrafts(raw: unknown[]): AiTicketDraft[] {
    const out: AiTicketDraft[] = [];
    for (let i = 0; i < raw.length; i++) {
      const row = raw[i];
      if (!row || typeof row !== 'object') {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_GATEWAY,
            message: `Ticket at index ${i} is not an object.`,
            code: 'AI_INVALID_TICKET_ENTRY',
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
      const t = row as Record<string, unknown>;
      const title = typeof t.title === 'string' ? t.title.trim() : '';
      const type = t.type as string;
      const description =
        typeof t.description === 'string' ? t.description.trim() : '';
      if (!title || !description || !TICKET_TYPES.has(type as TicketType)) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_GATEWAY,
            message: `Ticket at index ${i} is missing a valid title, description, or type.`,
            code: 'AI_INVALID_TICKET_FIELDS',
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
      const acceptanceCriteria = Array.isArray(t.acceptanceCriteria)
        ? t.acceptanceCriteria.filter(
            (x): x is string => typeof x === 'string' && x.trim().length > 0,
          )
        : [];
      let priority: TicketPriority | undefined;
      if (typeof t.priority === 'string' && PRIORITIES.has(t.priority as TicketPriority)) {
        priority = t.priority as TicketPriority;
      }
      let dependsOnIndices: number[] | undefined;
      if (Array.isArray(t.dependsOnIndices)) {
        dependsOnIndices = t.dependsOnIndices.filter(
          (x): x is number =>
            typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < i,
        );
      }
      let confidenceScore: number | undefined;
      if (typeof t.confidenceScore === 'number' && !Number.isNaN(t.confidenceScore)) {
        const c = t.confidenceScore;
        if (c >= 0 && c <= 1) {
          confidenceScore = c;
        }
      }
      out.push({
        title,
        type: type as TicketType,
        description,
        acceptanceCriteria,
        dependsOnIndices,
        priority,
        confidenceScore,
      });
    }
    return out;
  }

  getTicketsPromptVersion(): string {
    return TICKETS_PROMPT_VERSION;
  }

  private ensureClient(): OpenAI {
    if (!this.client) {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message:
            'Brief analysis is not available because the AI service is not configured on this server.',
          code: 'AI_NOT_CONFIGURED',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.client;
  }

  private async chatJsonObject(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): Promise<string> {
    const client = this.ensureClient();
    const model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model,
        response_format: { type: 'json_object' },
        messages,
      });
    } catch (err) {
      this.mapProviderError(err);
    }

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      this.logger.warn('OpenAI returned no message content');
      return '{}';
    }
    return text;
  }

  /** Never rethrows raw provider errors (avoids leaking API key fragments in HTTP responses). */
  private mapProviderError(err: unknown): never {
    if (err instanceof APIConnectionTimeoutError) {
      this.logger.warn('AI provider request timed out');
      throw new HttpException(
        {
          statusCode: HttpStatus.GATEWAY_TIMEOUT,
          message:
            'The brief analysis service took too long to respond. Please try again.',
          code: 'AI_TIMEOUT',
        },
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }

    if (err instanceof APIConnectionError) {
      this.logger.warn('AI provider connection error');
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message:
            'Could not reach the brief analysis service. Please try again in a moment.',
          code: 'AI_CONNECTION_ERROR',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (err instanceof RateLimitError) {
      this.logger.warn('AI provider rate limit exceeded');
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Too many brief analyses are being processed. Please wait and try again.',
          code: 'AI_RATE_LIMIT',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (err instanceof AuthenticationError) {
      this.logger.warn('AI provider rejected API credentials (invalid or revoked key)');
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message:
            'Brief analysis is unavailable because the AI service credentials on this server are invalid or expired.',
          code: 'AI_CREDENTIALS_INVALID',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (err instanceof PermissionDeniedError) {
      this.logger.warn('AI provider returned permission denied');
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message:
            'Brief analysis is unavailable because the AI provider denied access for this project.',
          code: 'AI_ACCESS_DENIED',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (err instanceof BadRequestError) {
      this.logger.warn('AI provider rejected the request (bad request)');
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message:
            'The AI service could not process this brief. It may be too long, or the configured model may be invalid.',
          code: 'AI_BAD_REQUEST',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (err instanceof InternalServerError) {
      this.logger.warn('AI provider returned a server error');
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message:
            'The brief analysis service returned an error. Please try again later.',
          code: 'AI_UPSTREAM_ERROR',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (err instanceof APIError) {
      const status = err.status;
      this.logger.warn(`AI provider error (HTTP ${String(status)})`);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message: 'Brief analysis failed. Please try again later.',
          code: 'AI_UNKNOWN_ERROR',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (err instanceof OpenAIError) {
      this.logger.warn(`OpenAI client error: ${err.name}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message: 'Brief analysis failed. Please try again later.',
          code: 'AI_CLIENT_ERROR',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.error('Unexpected error during AI ambiguity analysis');
    throw new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          'An unexpected error occurred while analyzing the brief. Please try again later.',
        code: 'AI_INTERNAL_ERROR',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
