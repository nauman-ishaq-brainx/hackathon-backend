import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiModule } from '../ai/ai.module';
import { Brief, BriefSchema } from '../briefs/schemas/brief.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { AmbiguitiesController } from './ambiguities.controller';
import { AmbiguitiesService } from './ambiguities.service';
import { Ambiguity, AmbiguitySchema } from './schemas/ambiguity.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ambiguity.name, schema: AmbiguitySchema },
      { name: Brief.name, schema: BriefSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
    AiModule,
  ],
  controllers: [AmbiguitiesController],
  providers: [AmbiguitiesService],
  exports: [MongooseModule],
})
export class AmbiguitiesModule {}
