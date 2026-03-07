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
import { Prisma } from '@prisma/client';

@Controller('api/nodes')
@UseGuards(JwtAuthGuard)
export class NodesController {
  constructor(private readonly nodeRepo: NodeRepository) {}

  @Get('flow')
  async getMyFlow(@Req() req) {
    const flow = await this.nodeRepo.findFlowByUserId(req.user.id);
    if (!flow) throw new NotFoundException('No flow found for user');
    return flow;
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
