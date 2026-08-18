import { IsString, IsOptional, IsIn } from 'class-validator';
import { NodeOnError } from '@prisma/client';

export class CreateNodeDto {
  @IsString()
  name: string;

  @IsString()
  systemPrompt: string;

  @IsOptional()
  tools?: unknown;

  @IsOptional()
  @IsString()
  preCode?: string;

  @IsOptional()
  preCodeInputSchema?: unknown;

  @IsOptional()
  @IsString()
  postCode?: string;

  @IsOptional()
  postCodeInputSchema?: unknown;

  @IsOptional()
  todos?: unknown;

  @IsOptional()
  @IsIn(['hitl', 'log', 'retry'])
  onError?: NodeOnError;
}
