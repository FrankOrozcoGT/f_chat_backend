import { IsString } from 'class-validator';

export class MarkInternalDto {
  @IsString()
  channelName: string;

  @IsString()
  internalPurpose: string;
}
