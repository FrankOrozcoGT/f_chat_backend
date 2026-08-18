import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewInternalDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  modifiedPurpose?: string | null;
}
