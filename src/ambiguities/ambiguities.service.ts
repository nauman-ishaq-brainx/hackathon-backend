import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiService } from '../ai/ai.service';
import { Brief, BriefDocument } from '../briefs/schemas/brief.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import type { AiTicketDraft } from '../ai/ai-ticket.types';
import { SubmitAmbiguityAnswersDto } from './dto/submit-ambiguity-answers.dto';
import { Ambiguity, AmbiguityDocument } from './schemas/ambiguity.schema';

@Injectable()
export class AmbiguitiesService {
  constructor(
    @InjectModel(Ambiguity.name)
    private readonly ambiguityModel: Model<AmbiguityDocument>,
    @InjectModel(Brief.name) private readonly briefModel: Model<BriefDocument>,
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    private readonly aiService: AiService,
    private readonly config: ConfigService,
  ) {}

  async submitAnswers(dto: SubmitAmbiguityAnswersDto): Promise<{
    success: true;
    tickets: Record<string, unknown>[];
  }> {
    const brief = await this.briefModel.findById(dto.briefId).exec();
    if (!brief) {
      throw new NotFoundException({
        message: `No brief found with id "${dto.briefId}".`,
        code: 'BRIEF_NOT_FOUND',
      });
    }

    const ambiguities = await this.ambiguityModel
      .find({ brief: dto.briefId })
      .sort({ createdAt: 1 })
      .exec();

    if (ambiguities.length === 0) {
      throw new BadRequestException({
        message:
          'This brief has no ambiguities to answer. Submit a brief through the briefs endpoint first.',
        code: 'NO_AMBIGUITIES',
      });
    }

    this.assertCompleteAnswers(dto, ambiguities);

    const answerById = new Map<string, string>(
      dto.answers.map((a) => [a.ambiguityId, a.answer]),
    );

    await Promise.all(
      ambiguities.map((amb) =>
        this.ambiguityModel
          .findByIdAndUpdate(amb._id, {
            $set: { answer: answerById.get(amb._id.toString()) },
          })
          .exec(),
      ),
    );

    const resolved = ambiguities.map((amb) => ({
      text: amb.text,
      answer: answerById.get(amb._id.toString()) ?? '',
    }));

    const drafts = await this.aiService.generateTickets({
      rawBrief: brief.rawBrief,
      resolvedAmbiguities: resolved,
    });

    const briefOid = new Types.ObjectId(dto.briefId);
    const tickets = await this.persistTickets(briefOid, drafts);

    return { success: true, tickets };
  }

  private assertCompleteAnswers(
    dto: SubmitAmbiguityAnswersDto,
    ambiguities: AmbiguityDocument[],
  ): void {
    const expected = new Set(ambiguities.map((d) => d._id.toString()));

    if (dto.answers.length !== expected.size) {
      throw new BadRequestException({
        message: `This brief has ${expected.size} ambiguities; you must submit exactly ${expected.size} answers (got ${dto.answers.length}).`,
        code: 'INCOMPLETE_AMBIGUITY_ANSWERS',
      });
    }

    const seen = new Set<string>();
    for (const item of dto.answers) {
      if (seen.has(item.ambiguityId)) {
        throw new BadRequestException({
          message: 'Each ambiguity may only appear once in the answers list.',
          code: 'DUPLICATE_AMBIGUITY_ANSWER',
        });
      }
      seen.add(item.ambiguityId);

      if (!expected.has(item.ambiguityId)) {
        throw new BadRequestException({
          message: `Ambiguity "${item.ambiguityId}" does not belong to this brief.`,
          code: 'AMBIGUITY_NOT_FOR_BRIEF',
        });
      }
    }
  }

  private async persistTickets(
    briefOid: Types.ObjectId,
    drafts: AiTicketDraft[],
  ): Promise<Record<string, unknown>[]> {
    await this.ticketModel.deleteMany({ briefId: briefOid }).exec();

    if (drafts.length === 0) {
      return [];
    }

    const modelName = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    const promptVersion = this.aiService.getTicketsPromptVersion();
    const generatedAt = new Date();

    const insertedIds: Types.ObjectId[] = [];
    for (const d of drafts) {
      const doc = await this.ticketModel.create({
        briefId: briefOid,
        title: d.title,
        type: d.type,
        description: d.description,
        acceptanceCriteria: d.acceptanceCriteria,
        dependencies: [],
        priority: d.priority ?? 'Medium',
        status: 'generated',
        aiMetadata: {
          model: modelName,
          promptVersion,
          generatedAt,
          confidenceScore: d.confidenceScore,
        },
      });
      insertedIds.push(doc._id as Types.ObjectId);
    }

    for (let i = 0; i < drafts.length; i++) {
      const idxs = (drafts[i].dependsOnIndices ?? []).filter(
        (j) => j >= 0 && j < insertedIds.length && j !== i,
      );
      const deps = idxs.map((j) => insertedIds[j]);
      await this.ticketModel
        .findByIdAndUpdate(insertedIds[i], { $set: { dependencies: deps } })
        .exec();
    }

    return (await this.ticketModel
      .find({ briefId: briefOid })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as unknown as Record<string, unknown>[];
  }
}
