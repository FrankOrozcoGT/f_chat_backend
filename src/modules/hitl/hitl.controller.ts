import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { HitlService } from './hitl.service';
import { TakeControlDto } from './dto/take-control.dto';
import { ReturnToAiDto } from './dto/return-to-ai.dto';

@Controller('api/hitl')
export class HitlController {
  constructor(private readonly hitlService: HitlService) {}

  @Post('take-control')
  @UseGuards(JwtAuthGuard)
  async takeControl(@Body() dto: TakeControlDto, @Req() req) {
    return this.hitlService.takeControl(dto.conversationId, req.user);
  }

  @Post('return-to-ai')
  @UseGuards(JwtAuthGuard)
  async returnToAi(@Body() dto: ReturnToAiDto, @Req() req) {
    return this.hitlService.returnToAi(dto.conversationId, req.user);
  }
}
