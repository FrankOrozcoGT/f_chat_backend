import { IsString, IsNotEmpty } from 'class-validator';

export class TestSendDto {
  @IsString()
  @IsNotEmpty()
  testId: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
