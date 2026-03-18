import { IsString } from 'class-validator';

export class CreateFlowDto {
  @IsString()
  name: string;

  @IsString()
  routerNodeId: string;
}
