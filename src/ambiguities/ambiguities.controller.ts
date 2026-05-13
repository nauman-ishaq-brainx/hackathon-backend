import { Body, Controller, Post } from '@nestjs/common';
import { AmbiguitiesService } from './ambiguities.service';
import { SubmitAmbiguityAnswersDto } from './dto/submit-ambiguity-answers.dto';

@Controller('ambiguities')
export class AmbiguitiesController {
  constructor(private readonly ambiguitiesService: AmbiguitiesService) {}

  @Post('answers')
  submitAnswers(@Body() dto: SubmitAmbiguityAnswersDto) {
    return this.ambiguitiesService.submitAnswers(dto);
  }
}
