import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiModule } from '../ai/ai.module';
import { AmbiguitiesModule } from '../ambiguities/ambiguities.module';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { BriefsController } from './briefs.controller';
import { BriefsService } from './briefs.service';
import { Brief, BriefSchema } from './schemas/brief.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Brief.name, schema: BriefSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
    AmbiguitiesModule,
    AiModule,
  ],
  controllers: [BriefsController],
  providers: [BriefsService],
})
export class BriefsModule {}
