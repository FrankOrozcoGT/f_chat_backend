import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { NodeRepository } from './repositories/node.repository';
import { NodeSessionRepository } from './repositories/node-session.repository';
import { TestSessionService } from './services/test-session.service';
import { DispatcherService } from './services/dispatcher.service';
import { PhoneRepository } from '@modules/phones/repositories/phone.repository';
import { TestStartDto } from './dto/test-start.dto';
import { TestSendDto } from './dto/test-send.dto';
import { TestStepBackDto } from './dto/test-step-back.dto';
import { Prisma } from '@prisma/client';

@Controller('api/nodes')
@UseGuards(JwtAuthGuard)
export class NodesController {
  constructor(
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
    private readonly testSessionService: TestSessionService,
    private readonly dispatcherService: DispatcherService,
    private readonly phoneRepo: PhoneRepository,
  ) {}

  @Get('flows')
  async getMyFlows(@Req() req) {
    return this.nodeRepo.findAllFlowsByUserId(req.user.id);
  }

  @Get('flows/active-sessions')
  async getActiveSessions(@Req() req) {
    const flows = await this.nodeRepo.findAllFlowsByUserId(req.user.id);
    const flowIds = flows.map((f) => f.id);
    if (flowIds.length === 0) return {};
    return this.nodeSessionRepo.countActiveByNode(flowIds);
  }

  @Get(':id')
  async getNode(@Param('id') id: string) {
    const node = await this.nodeRepo.findById(id);
    if (!node) throw new NotFoundException('Node not found');
    return node;
  }

  @Post()
  async createNode(@Body() body: Prisma.NodeCreateInput) {
    return this.nodeRepo.createNode(body);
  }

  @Put(':id')
  async updateNode(
    @Param('id') id: string,
    @Body() body: Prisma.NodeUpdateInput,
  ) {
    return this.nodeRepo.updateNode(id, body);
  }

  @Post('flow/:flowId/nodes/:nodeId')
  async addNodeToFlow(
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.nodeRepo.addNodeToFlow(flowId, nodeId);
  }

  @Post('test/start')
  async startTest(@Req() req, @Body() dto: TestStartDto) {
    const phone = await this.phoneRepo.findFirstByUserId(req.user.id);
    if (!phone) {
      throw new BadRequestException('No phone found for user. Connect a phone first.');
    }
    const testId = await this.testSessionService.start(
      dto.conversationId,
      dto.flowId,
      dto.clientPhone,
      phone.instanceName,
      req.user.id,
    );
    return { testId };
  }

  @Post('test/send')
  async sendTest(@Body() dto: TestSendDto) {
    const session = await this.testSessionService.getSession(dto.testId);

    const result = await this.dispatcherService.dispatchTest(session, dto.message);

    // Construir history actualizado con el mensaje del usuario + respuesta
    const updatedHistory = [
      ...session.history,
      { role: 'user', content: dto.message },
    ];
    if (result.response) {
      updatedHistory.push({ role: 'assistant', content: result.response });
    }

    // Guardar step en Redis
    await this.testSessionService.pushStep(dto.testId, {
      message: dto.message,
      response: result.response,
      nodeId: session.currentNodeId,
      historySnapshot: updatedHistory,
    });

    return {
      response: result.response,
      intent: result.intent,
      currentNodeId: session.currentNodeId,
      sideEffects: result.sideEffects ?? [],
    };
  }

  @Post('test/step-back')
  async stepBackTest(@Body() dto: TestStepBackDto) {
    const result = await this.testSessionService.popStep(dto.testId);
    if (result.currentNodeId === null && result.lastMessage === null) {
      throw new BadRequestException('No steps to go back to');
    }
    return result;
  }
}
