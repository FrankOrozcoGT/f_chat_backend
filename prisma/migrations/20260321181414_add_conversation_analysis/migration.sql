-- CreateTable
CREATE TABLE "ConversationAnalysis" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "intent" TEXT,
    "flowDiagram" TEXT,
    "flowSummary" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAnalysis_conversationId_key" ON "ConversationAnalysis"("conversationId");

-- AddForeignKey
ALTER TABLE "ConversationAnalysis" ADD CONSTRAINT "ConversationAnalysis_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
