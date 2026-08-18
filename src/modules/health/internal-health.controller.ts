import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InternalGuard } from '@common/guards/internal.guard';
import { InternalHealthService } from './internal-health.service';

@Controller('internal/health')
@UseGuards(InternalGuard)
export class InternalHealthController {
  constructor(private readonly internalHealthService: InternalHealthService) {}

  @Post('mark-down')
  async markDown(
    @Body('apiName') apiName: string,
    @Body('message') message: string,
  ) {
    await this.internalHealthService.markDown(apiName, message);
  }
}
