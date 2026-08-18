import { IsString, IsNotEmpty } from 'class-validator';

export class TestStopDto {
  @IsString()
  @IsNotEmpty()
  testId: string;
}
