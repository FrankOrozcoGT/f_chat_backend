import { BadRequestException, Injectable } from '@nestjs/common';
import { ApiName } from '@prisma/client';
import { ApiHealthRepository } from './repositories/api-health.repository';

@Injectable()
export class InternalHealthService {
  constructor(private readonly apiHealthRepository: ApiHealthRepository) {}

  async markDown(apiName: string, message: string): Promise<void> {
    if (!Object.values(ApiName).includes(apiName as ApiName)) {
      throw new BadRequestException(`Unknown apiName "${apiName}". Valid values: ${Object.values(ApiName).join(', ')}`);
    }
    await this.apiHealthRepository.markAsDown(apiName as ApiName, message);
  }
}
