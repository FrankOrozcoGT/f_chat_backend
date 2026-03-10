-- CreateEnum
CREATE TYPE "NodeOnError" AS ENUM ('hitl', 'log', 'retry');

-- CreateEnum
CREATE TYPE "NodeSessionStatus" AS ENUM ('active', 'closed');

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "routerNodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "tools" JSONB,
    "preCode" TEXT,
    "preCodeInputSchema" JSONB,
    "postCode" TEXT,
    "postCodeInputSchema" JSONB,
    "onError" "NodeOnError" NOT NULL DEFAULT 'hitl',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowNode" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,

    CONSTRAINT "FlowNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeSession" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "currentNodeId" TEXT,
    "detectedIntent" TEXT,
    "status" "NodeSessionStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Flow_userId_idx" ON "Flow"("userId");

-- CreateIndex
CREATE INDEX "FlowNode_flowId_idx" ON "FlowNode"("flowId");

-- CreateIndex
CREATE INDEX "FlowNode_nodeId_idx" ON "FlowNode"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowNode_flowId_nodeId_key" ON "FlowNode"("flowId", "nodeId");

-- CreateIndex
CREATE INDEX "NodeSession_conversationId_idx" ON "NodeSession"("conversationId");

-- CreateIndex
CREATE INDEX "NodeSession_flowId_idx" ON "NodeSession"("flowId");

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_routerNodeId_fkey" FOREIGN KEY ("routerNodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowNode" ADD CONSTRAINT "FlowNode_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowNode" ADD CONSTRAINT "FlowNode_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSession" ADD CONSTRAINT "NodeSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSession" ADD CONSTRAINT "NodeSession_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSession" ADD CONSTRAINT "NodeSession_currentNodeId_fkey" FOREIGN KEY ("currentNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;
