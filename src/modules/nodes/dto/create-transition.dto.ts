import { IsString } from 'class-validator';

export class CreateTransitionDto {
  @IsString()
  fromNodeId: string;

  @IsString()
  toNodeId: string;

  @IsString()
  transitionCode: string;
}
