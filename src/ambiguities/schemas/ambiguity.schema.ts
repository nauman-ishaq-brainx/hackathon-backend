import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AmbiguityDocument = HydratedDocument<Ambiguity>;

@Schema({ timestamps: true, collection: 'ambiguities' })
export class Ambiguity {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Brief',
    required: true,
    index: true,
  })
  brief: Types.ObjectId;

  /** Detected ambiguity text (question / gap) */
  @Prop({ required: true })
  text: string;

  @Prop({ type: String, default: null })
  answer: string | null;
}

export const AmbiguitySchema = SchemaFactory.createForClass(Ambiguity);
