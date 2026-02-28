import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { ApiHealthRepository } from './repositories/api-health.repository';

@Controller('internal/health')
@UseGuards(InternalGuard)
export class InternalHealthController {
  constructor(private readonly apiHealthRepository: ApiHealthRepository) {}

  @Post('mark-down')
  async markDown(
    @Body('apiName') apiName: string,
    @Body('message') message: string,
  ) {
    await this.apiHealthRepository.markAsDown(apiName as any, message);
  }
}
