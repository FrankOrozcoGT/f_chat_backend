-- CreateTable
CREATE TABLE "ConversationStats" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastMessageDirection" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationStats_conversationId_key" ON "ConversationStats"("conversationId");

-- AddForeignKey
ALTER TABLE "ConversationStats" ADD CONSTRAINT "ConversationStats_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
