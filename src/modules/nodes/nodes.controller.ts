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
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { NodeRepository } from './repositories/node.repository';
import { NodeSessionRepository } from './repositories/node-session.repository';
import { Prisma } from '@prisma/client';

@Controller('api/nodes')
@UseGuards(JwtAuthGuard)
export class NodesController {
  constructor(
    private readonly nodeRepo: NodeRepository,
    private readonly nodeSessionRepo: NodeSessionRepository,
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
}
