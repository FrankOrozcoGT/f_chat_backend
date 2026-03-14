import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class NodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.node.findUnique({ where: { id } });
  }

  async findFlowWithNodes(flowId: string) {
    return this.prisma.flow.findUnique({
      where: { id: flowId },
      include: {
        routerNode: true,
        nodes: { include: { node: true } },
        transitions: { include: { fromNode: true, toNode: true } },
      },
    });
  }

  async findFlowByUserId(userId: string) {
    return this.prisma.flow.findFirst({
      where: { userId },
      include: {
        routerNode: true,
        nodes: { include: { node: true } },
        transitions: { include: { fromNode: true, toNode: true } },
      },
    });
  }

  async findAllFlowsByUserId(userId: string) {
    return this.prisma.flow.findMany({
      where: { userId },
      include: {
        routerNode: true,
        nodes: { include: { node: true } },
        transitions: { include: { fromNode: true, toNode: true } },
      },
    });
  }

  async createNode(data: Prisma.NodeCreateInput) {
    return this.prisma.node.create({ data });
  }

  async updateNode(id: string, data: Prisma.NodeUpdateInput) {
    return this.prisma.node.update({ where: { id }, data });
  }

  async createFlow(data: {
    name: string;
    routerNodeId: string;
    userId: string;
  }) {
    return this.prisma.flow.create({ data });
  }

  async addNodeToFlow(flowId: string, nodeId: string) {
    return this.prisma.flowNode.create({
      data: { flowId, nodeId },
    });
  }

  async removeNodeFromFlow(flowId: string, nodeId: string) {
    return this.prisma.flowNode.deleteMany({
      where: { flowId, nodeId },
    });
  }

  async findTransition(flowId: string, fromNodeId: string, transitionCode: string) {
    return this.prisma.flowTransition.findUnique({
      where: { flowId_transitionCode: { flowId, transitionCode } },
      include: { toNode: true },
    });
  }
}
