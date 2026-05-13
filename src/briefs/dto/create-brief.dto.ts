import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateBriefDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120_000)
  brief: string;
}
