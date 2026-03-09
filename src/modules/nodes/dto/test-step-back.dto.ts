import { IsString, IsNotEmpty } from 'class-validator';

export class TestStepBackDto {
  @IsString()
  @IsNotEmpty()
  testId: string;
}
