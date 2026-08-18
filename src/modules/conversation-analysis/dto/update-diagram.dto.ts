import { IsString } from 'class-validator';

export class UpdateDiagramDto {
  @IsString()
  diagram: string;
}
