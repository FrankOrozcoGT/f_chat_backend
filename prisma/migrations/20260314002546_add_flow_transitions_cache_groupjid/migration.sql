-- AlterTable
ALTER TABLE "NodeSession" ADD COLUMN     "cachedNodeData" JSONB;

-- AlterTable
ALTER TABLE "QueueRequest" ADD COLUMN     "groupJid" TEXT;

-- CreateTable
CREATE TABLE "FlowTransition" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "transitionCode" TEXT NOT NULL,

    CONSTRAINT "FlowTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowTransition_flowId_fromNodeId_idx" ON "FlowTransition"("flowId", "fromNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowTransition_flowId_transitionCode_key" ON "FlowTransition"("flowId", "transitionCode");

-- AddForeignKey
ALTER TABLE "FlowTransition" ADD CONSTRAINT "FlowTransition_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowTransition" ADD CONSTRAINT "FlowTransition_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowTransition" ADD CONSTRAINT "FlowTransition_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
