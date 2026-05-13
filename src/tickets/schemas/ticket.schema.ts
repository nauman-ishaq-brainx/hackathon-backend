import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class AiMetadata {
  @Prop({ type: String })
  model?: string;

  @Prop({ type: String })
  promptVersion?: string;

  @Prop({ type: Date })
  generatedAt?: Date;

  @Prop({ type: Number, min: 0, max: 1 })
  confidenceScore?: number;
}

export const AiMetadataSchema = SchemaFactory.createForClass(AiMetadata);

export type TicketDocument = HydratedDocument<Ticket>;

@Schema({ timestamps: true, collection: 'tickets' })
export class Ticket {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Brief',
    required: true,
    index: true,
  })
  briefId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({
    type: String,
    enum: ['Epic', 'Story', 'Task', 'Subtask'],
    required: true,
  })
  type: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String], default: [] })
  acceptanceCriteria: string[];

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Ticket' }],
    default: [],
  })
  dependencies: Types.ObjectId[];

  @Prop({
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium',
  })
  priority: string;

  @Prop({
    type: String,
    enum: ['draft', 'generated', 'approved', 'rejected'],
    default: 'generated',
  })
  status: string;

  @Prop({ type: AiMetadataSchema, required: false })
  aiMetadata?: AiMetadata;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
