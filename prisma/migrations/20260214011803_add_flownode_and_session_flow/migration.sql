-- CreateEnum
CREATE TYPE "FlowNodeStatus" AS ENUM ('clarifying', 'understood', 'executing', 'completed', 'abandoned');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "flowNodeId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "currentNodeId" TEXT,
ADD COLUMN     "mermaidFlowchart" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "FlowNode" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "understanding" TEXT NOT NULL DEFAULT '',
    "status" "FlowNodeStatus" NOT NULL DEFAULT 'clarifying',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowNode_sessionId_idx" ON "FlowNode"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowNode_sessionId_nodeId_key" ON "FlowNode"("sessionId", "nodeId");

-- CreateIndex
CREATE INDEX "Message_flowNodeId_idx" ON "Message"("flowNodeId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_flowNodeId_fkey" FOREIGN KEY ("flowNodeId") REFERENCES "FlowNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowNode" ADD CONSTRAINT "FlowNode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
