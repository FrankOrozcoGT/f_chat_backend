import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreatePhoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  instanceName: string;
}
