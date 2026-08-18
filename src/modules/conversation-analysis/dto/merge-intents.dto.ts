import { IsArray, ArrayMinSize, IsString } from 'class-validator';

export class MergeIntentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceIntentIds: string[];
}
