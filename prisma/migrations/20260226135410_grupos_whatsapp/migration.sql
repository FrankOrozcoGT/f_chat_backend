/*
  Warnings:

  - A unique constraint covering the columns `[groupJid]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('individual', 'group');

-- DropIndex
DROP INDEX "Conversation_phoneId_clientId_key";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "groupJid" TEXT,
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "type" "ConversationType" NOT NULL DEFAULT 'individual',
ALTER COLUMN "clientId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_clientId_idx" ON "ConversationParticipant"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_clientId_key" ON "ConversationParticipant"("conversationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_groupJid_key" ON "Conversation"("groupJid");

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing individual conversations: move clientId -> ConversationParticipant
INSERT INTO "ConversationParticipant" ("id", "conversationId", "clientId", "role", "joinedAt")
SELECT gen_random_uuid(), "id", "clientId", 'member', "createdAt"
FROM "Conversation"
WHERE "clientId" IS NOT NULL
ON CONFLICT ("conversationId", "clientId") DO NOTHING;

-- Partial unique index: enforce phoneId+clientId uniqueness only for individual conversations
CREATE UNIQUE INDEX "Conversation_phoneId_clientId_individual_key"
ON "Conversation" ("phoneId", "clientId")
WHERE "type" = 'individual';
