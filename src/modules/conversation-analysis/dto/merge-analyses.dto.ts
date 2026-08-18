import { IsArray, ArrayMinSize, IsString } from 'class-validator';

export class MergeAnalysesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceIntents: string[];

  @IsString()
  targetIntent: string;
}
