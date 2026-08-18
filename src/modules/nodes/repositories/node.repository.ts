import { Injectable } from '@nestjs/common';
import { Prisma, $Enums } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { TodoDefinition } from '@modules/nodes/functions/implementations/update-todos.fn';

@Injectable()
export class NodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tenantId?: string) {
    return this.prisma.node.findFirst({
      where: { id, ...(tenantId !== undefined && { tenantId }) },
    });
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

  async findFlowById(flowId: string) {
    return this.prisma.flow.findUnique({
      where: { id: flowId },
      include: {
        intents: { select: { id: true, name: true } },
        _count: { select: { analysisFlows: true } },
      },
    });
  }

  async findAllFlowsByTenantId(tenantId: string) {
    const flows = await this.prisma.flow.findMany({
      where: { tenantId },
      include: {
        routerNode: true,
        nodes: { include: { node: true } },
        transitions: { include: { fromNode: true, toNode: true } },
        intents: { select: { id: true, name: true } },
        _count: { select: { analysisFlows: true } },
      },
    });
    return flows
      .map((f) => ({ ...f, analysisCount: f._count.analysisFlows }))
      .sort((a, b) => b.analysisCount - a.analysisCount);
  }

  async createNode(data: Prisma.NodeCreateInput) {
    return this.prisma.node.create({ data });
  }

  async updateNode(id: string, tenantId: string, data: Prisma.NodeUpdateInput) {
    const node = await this.prisma.node.findFirst({ where: { id, tenantId } });
    if (!node) return null;
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

  async updateFlow(id: string, tenantId: string, data: { name?: string; routerNodeId?: string }) {
    const flow = await this.prisma.flow.findFirst({ where: { id, tenantId } });
    if (!flow) return null;
    return this.prisma.flow.update({ where: { id }, data });
  }

  async deleteFlow(id: string, tenantId: string) {
    const flow = await this.prisma.flow.findFirst({ where: { id, tenantId } });
    if (!flow) return null;
    return this.prisma.flow.delete({ where: { id } });
  }

  async findTransitionsByFlowId(flowId: string, tenantId: string) {
    return this.prisma.flowTransition.findMany({
      where: { flowId, flow: { tenantId } },
      include: { fromNode: true, toNode: true },
    });
  }

  async createTransition(data: { flowId: string; fromNodeId: string; toNodeId: string; transitionCode: string }) {
    return this.prisma.flowTransition.create({
      data,
      include: { fromNode: true, toNode: true },
    });
  }

  async deleteTransition(id: string, tenantId: string) {
    const result = await this.prisma.flowTransition.deleteMany({
      where: { id, flow: { tenantId } },
    });
    return result;
  }

  async setFlowStatus(id: string, status: $Enums.FlowStatus) {
    return this.prisma.flow.update({ where: { id }, data: { status } });
  }

  async replaceFlowNodes(
    flowId: string,
    nodes: { name: string; systemPrompt: string; todos?: TodoDefinition[]; tools?: string[] }[],
    transitions: { fromNodeIndex: number; toNodeIndex: number; transitionCode: string }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const flow = await tx.flow.findUnique({ where: { id: flowId }, select: { tenantId: true } });

      // Eliminar transiciones y FlowNodes actuales (los nodos huérfanos se limpian aparte)
      await tx.flowTransition.deleteMany({ where: { flowId } });
      await tx.flowNode.deleteMany({ where: { flowId } });

      // Crear nuevos nodos
      const createdNodes = await Promise.all(
        nodes.map((n) =>
          tx.node.create({
            data: {
              tenantId: flow?.tenantId,
              name: n.name,
              systemPrompt: n.systemPrompt,
              todos: (n.todos ?? []) as unknown as Prisma.InputJsonValue,
              tools: (n.tools ?? []) as unknown as Prisma.InputJsonValue,
            },
          }),
        ),
      );

      // Actualizar routerNodeId al primer nodo nuevo
      await tx.flow.update({
        where: { id: flowId },
        data: { routerNodeId: createdNodes[0].id },
      });

      // Vincular nodos al flow
      await Promise.all(
        createdNodes.map((node) =>
          tx.flowNode.create({ data: { flowId, nodeId: node.id } }),
        ),
      );

      // Crear transiciones
      await Promise.all(
        transitions.map((t) =>
          tx.flowTransition.create({
            data: {
              flowId,
              fromNodeId: createdNodes[t.fromNodeIndex].id,
              toNodeId: createdNodes[t.toNodeIndex].id,
              transitionCode: t.transitionCode,
            },
          }),
        ),
      );

      return { flow: flowId, nodes: createdNodes };
    });
  }

  async createFlowWithNodes(data: {
    name: string;
    tenantId: string;
    nodes: { name: string; systemPrompt: string; todos?: TodoDefinition[]; tools?: string[] }[];
    transitions: { fromNodeIndex: number; toNodeIndex: number; transitionCode: string }[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Crear todos los nodos
      const createdNodes = await Promise.all(
        data.nodes.map((n) =>
          tx.node.create({
            data: {
              tenantId: data.tenantId,
              name: n.name,
              systemPrompt: n.systemPrompt,
              todos: (n.todos ?? []) as unknown as Prisma.InputJsonValue,
              tools: (n.tools ?? []) as unknown as Prisma.InputJsonValue,
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

  async createDraftFlow(data: { name: string; tenantId: string }) {
    return this.prisma.flow.create({
      data: {
        name: data.name,
        tenantId: data.tenantId,
        status: 'draft',
      },
    });
  }
}
