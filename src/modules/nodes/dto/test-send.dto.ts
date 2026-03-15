import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class TestSendDto {
  @IsString()
  @IsNotEmpty()
  testId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  mediaUrl?: string;
}
