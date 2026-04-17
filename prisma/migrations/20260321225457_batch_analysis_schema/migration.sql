-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('active', 'draft');

-- CreateEnum
CREATE TYPE "LabelStatus" AS ENUM ('active', 'draft');

-- AlterTable
ALTER TABLE "ContactLabel" ADD COLUMN     "status" "LabelStatus" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "ConversationAnalysis" ADD COLUMN     "internalPurpose" TEXT,
ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Flow" ADD COLUMN     "status" "FlowStatus" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "Intent" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ConversationAnalysisFlow" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAnalysisFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationAnalysisFlow_analysisId_idx" ON "ConversationAnalysisFlow"("analysisId");

-- CreateIndex
CREATE INDEX "ConversationAnalysisFlow_flowId_idx" ON "ConversationAnalysisFlow"("flowId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAnalysisFlow_analysisId_flowId_key" ON "ConversationAnalysisFlow"("analysisId", "flowId");

-- AddForeignKey
ALTER TABLE "ConversationAnalysisFlow" ADD CONSTRAINT "ConversationAnalysisFlow_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ConversationAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAnalysisFlow" ADD CONSTRAINT "ConversationAnalysisFlow_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
