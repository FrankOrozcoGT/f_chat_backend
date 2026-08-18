import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { TestSessionService } from './test-session.service';
import { TestStartDto } from './dto/test-start.dto';
import { TestSendDto } from './dto/test-send.dto';
import { TestStepBackDto } from './dto/test-step-back.dto';
import { TestStopDto } from './dto/test-stop.dto';

@Controller('api/nodes/test')
@UseGuards(JwtAuthGuard)
export class FlowTestController {
  constructor(
    private readonly phoneRepo: PhoneRepository,
    private readonly testSessionService: TestSessionService,
  ) {}

  @Post('start')
  async startTest(@Req() req, @Body() dto: TestStartDto) {
    const phone = await this.phoneRepo.findFirstByTenantId(req.user.tenantId);
    if (!phone) {
      throw new BadRequestException('No phone found for user. Connect a phone first.');
    }
    const testId = await this.testSessionService.start(
      dto.conversationId,
      dto.flowId ?? null,
      dto.clientPhone,
      phone.instanceName,
      req.user.tenantId,
    );
    return { testId };
  }

  @Post('send')
  async sendTest(@Body() dto: TestSendDto) {
    return this.testSessionService.sendMessage(dto.testId, dto.message, dto.mediaUrl);
  }

  @Post('step-back')
  async stepBackTest(@Body() dto: TestStepBackDto) {
    const result = await this.testSessionService.popStep(dto.testId);
    if (result.currentNodeId === null && result.lastMessage === null) {
      throw new BadRequestException('No steps to go back to');
    }
    return result;
  }

  @Post('stop')
  async stopTest(@Body() dto: TestStopDto) {
    await this.testSessionService.stop(dto.testId);
    return {};
  }
}
