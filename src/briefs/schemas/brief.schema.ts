import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BriefDocument = HydratedDocument<Brief>;

@Schema({ timestamps: true, collection: 'briefs' })
export class Brief {
  @Prop({ required: true })
  rawBrief: string;
}

export const BriefSchema = SchemaFactory.createForClass(Brief);
