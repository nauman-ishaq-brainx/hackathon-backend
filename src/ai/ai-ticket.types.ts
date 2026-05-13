export type TicketType = 'Epic' | 'Story' | 'Task' | 'Subtask';
export type TicketPriority = 'Low' | 'Medium' | 'High';

/** Parsed from model JSON before persistence (dependencies as indices into the tickets array). */
export interface AiTicketDraft {
  title: string;
  type: TicketType;
  description: string;
  acceptanceCriteria: string[];
  /** 0-based indices of other tickets in the same generated list this item depends on. */
  dependsOnIndices?: number[];
  priority?: TicketPriority;
  confidenceScore?: number;
}
