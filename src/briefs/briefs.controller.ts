import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateBriefDto } from './dto/create-brief.dto';
import { BriefsService } from './briefs.service';

@Controller('briefs')
export class BriefsController {
  constructor(private readonly briefsService: BriefsService) {}

  @Get(':briefId/ambiguities')
  listAmbiguitiesForBrief(@Param('briefId') briefId: string) {
    return this.briefsService.findAmbiguitiesForBrief(briefId);
  }

  @Get(':briefId/tickets')
  listTicketsForBrief(@Param('briefId') briefId: string) {
    return this.briefsService.findTicketsForBrief(briefId);
  }

  @Post()
  create(@Body() dto: CreateBriefDto) {
    return this.briefsService.create(dto);
  }
}
