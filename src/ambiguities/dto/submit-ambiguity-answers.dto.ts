import { Type } from 'class-transformer';
import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AmbiguityAnswerItemDto {
  @IsMongoId()
  ambiguityId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  answer: string;
}

export class SubmitAmbiguityAnswersDto {
  @IsMongoId()
  briefId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmbiguityAnswerItemDto)
  answers: AmbiguityAnswerItemDto[];
}
