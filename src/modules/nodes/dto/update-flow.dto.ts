import { IsString, IsOptional } from 'class-validator';

export class UpdateFlowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  routerNodeId?: string;
}
