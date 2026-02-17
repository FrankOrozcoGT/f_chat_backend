-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('AI', 'HITL');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('AI', 'HITL');

-- CreateEnum
CREATE TYPE "ApiType" AS ENUM ('qwen_stt', 'kimi_llm', 'qwen_tts');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('audio', 'image', 'video', 'document');

-- CreateEnum
CREATE TYPE "ApiName" AS ENUM ('qwen_stt', 'kimi_llm', 'qwen_tts');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('up', 'down', 'degraded');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "mode" "ConversationMode" NOT NULL DEFAULT 'HITL';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "costUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "SessionType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "takenBy" TEXT,
    "reason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCall" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "apiType" "ApiType" NOT NULL,
    "operation" TEXT NOT NULL,
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "whatsappMediaId" TEXT,
    "sizeBytes" INTEGER,
    "durationSeconds" DOUBLE PRECISION,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiHealth" (
    "id" TEXT NOT NULL,
    "apiName" "ApiName" NOT NULL,
    "status" "HealthStatus" NOT NULL DEFAULT 'up',
    "monitoringActive" BOOLEAN NOT NULL DEFAULT true,
    "responseTimeMs" INTEGER,
    "errorMessage" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastCheckAt" TIMESTAMP(3),
    "recoveredAt" TIMESTAMP(3),

    CONSTRAINT "ApiHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_conversationId_idx" ON "Session"("conversationId");

-- CreateIndex
CREATE INDEX "ApiCall_messageId_idx" ON "ApiCall"("messageId");

-- CreateIndex
CREATE INDEX "ApiCall_calledAt_idx" ON "ApiCall"("calledAt");

-- CreateIndex
CREATE INDEX "MediaFile_messageId_idx" ON "MediaFile"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiHealth_apiName_key" ON "ApiHealth"("apiName");

-- CreateIndex
CREATE INDEX "ApiHealth_apiName_idx" ON "ApiHealth"("apiName");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCall" ADD CONSTRAINT "ApiCall_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
