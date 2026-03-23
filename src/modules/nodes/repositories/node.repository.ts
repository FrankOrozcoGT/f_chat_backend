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

  async findFlowByTenantId(tenantId: string) {
    return this.prisma.flow.findFirst({
      where: { tenantId },
      include: {
        routerNode: true,
        nodes: { include: { node: true } },
        transitions: { include: { fromNode: true, toNode: true } },
      },
    });
  }

  async findAllFlowsByTenantId(tenantId: string) {
    return this.prisma.flow.findMany({
      where: { tenantId },
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
    routerNodeId: string; // nodo inicial del flow (primer nodo que recibe el mensaje al entrar al intent)
    tenantId: string;
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

  async updateFlow(id: string, data: { name?: string; routerNodeId?: string }) {
    return this.prisma.flow.update({ where: { id }, data });
  }

  async deleteFlow(id: string) {
    return this.prisma.flow.delete({ where: { id } });
  }

  async findTransitionsByFlowId(flowId: string) {
    return this.prisma.flowTransition.findMany({
      where: { flowId },
      include: { fromNode: true, toNode: true },
    });
  }

  async createTransition(data: { flowId: string; fromNodeId: string; toNodeId: string; transitionCode: string }) {
    return this.prisma.flowTransition.create({
      data,
      include: { fromNode: true, toNode: true },
    });
  }

  async deleteTransition(id: string) {
    return this.prisma.flowTransition.delete({ where: { id } });
  }

  async createFlowWithNodes(data: {
    name: string;
    tenantId: string;
    nodes: { name: string; systemPrompt: string; todos?: string[]; tools?: string[] }[];
    transitions: { fromNodeIndex: number; toNodeIndex: number; transitionCode: string }[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Crear todos los nodos
      const createdNodes = await Promise.all(
        data.nodes.map((n) =>
          tx.node.create({
            data: {
              name: n.name,
              systemPrompt: n.systemPrompt,
              todos: n.todos ?? [],
              tools: n.tools ?? [],
            },
          }),
        ),
      );

      // El primer nodo es el nodo inicial del flow
      const flow = await tx.flow.create({
        data: {
          name: data.name,
          tenantId: data.tenantId,
          status: 'draft',
          routerNodeId: createdNodes[0].id, // nodo inicial del flow
        },
      });

      // Vincular todos los nodos al flow
      await Promise.all(
        createdNodes.map((node) =>
          tx.flowNode.create({ data: { flowId: flow.id, nodeId: node.id } }),
        ),
      );

      // Crear transiciones usando índices para referenciar nodos creados
      await Promise.all(
        data.transitions.map((t) =>
          tx.flowTransition.create({
            data: {
              flowId: flow.id,
              fromNodeId: createdNodes[t.fromNodeIndex].id,
              toNodeId: createdNodes[t.toNodeIndex].id,
              transitionCode: t.transitionCode,
            },
          }),
        ),
      );

      return { flow, nodes: createdNodes };
    });
  }
}
