import { IsInt, Min } from 'class-validator';

export class RunBatchDto {
  @IsInt()
  @Min(1)
  channelCount: number;

  @IsInt()
  @Min(1)
  messageLimit: number;
}
