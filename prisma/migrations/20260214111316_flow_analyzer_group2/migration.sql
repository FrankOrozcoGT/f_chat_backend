/*
  Warnings:

  - You are about to drop the column `flowNodeId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `currentNodeId` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `mermaidFlowchart` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the `FlowNode` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "ApiType" ADD VALUE 'kimi_flow_analyzer';

-- DropForeignKey
ALTER TABLE "FlowNode" DROP CONSTRAINT "FlowNode_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_flowNodeId_fkey";

-- DropIndex
DROP INDEX "Message_flowNodeId_idx";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "flowNodeId";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "currentNodeId",
DROP COLUMN "mermaidFlowchart",
ADD COLUMN     "flowData" JSONB NOT NULL DEFAULT '{}';

-- DropTable
DROP TABLE "FlowNode";

-- DropEnum
DROP TYPE "FlowNodeStatus";

-- CreateTable
CREATE TABLE "ClientMemory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientMemory_clientId_idx" ON "ClientMemory"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientMemory_clientId_key_key" ON "ClientMemory"("clientId", "key");

-- AddForeignKey
ALTER TABLE "ClientMemory" ADD CONSTRAINT "ClientMemory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
