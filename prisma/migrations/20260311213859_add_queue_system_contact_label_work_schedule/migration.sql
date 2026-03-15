-- CreateEnum
CREATE TYPE "QueueRequestStatus" AS ENUM ('pending', 'sent', 'responded', 'expired', 'cancelled');

-- AlterEnum
ALTER TYPE "NodeSessionStatus" ADD VALUE 'waiting_queue';

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
ADD COLUMN     "workEndHour" INTEGER NOT NULL DEFAULT 17,
ADD COLUMN     "workStartHour" INTEGER NOT NULL DEFAULT 8;

-- CreateTable
CREATE TABLE "ContactLabel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeSessionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "currentNodeId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "destinationPhone" TEXT NOT NULL,
    "outgoingMessage" TEXT NOT NULL,
    "responseMessage" TEXT,
    "toolName" TEXT NOT NULL,
    "toolContext" JSONB,
    "status" "QueueRequestStatus" NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactLabel_userId_idx" ON "ContactLabel"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactLabel_userId_label_key" ON "ContactLabel"("userId", "label");

-- CreateIndex
CREATE INDEX "QueueRequest_nodeSessionId_idx" ON "QueueRequest"("nodeSessionId");

-- CreateIndex
CREATE INDEX "QueueRequest_destinationPhone_status_idx" ON "QueueRequest"("destinationPhone", "status");

-- CreateIndex
CREATE INDEX "QueueRequest_instanceName_destinationPhone_status_idx" ON "QueueRequest"("instanceName", "destinationPhone", "status");

-- AddForeignKey
ALTER TABLE "ContactLabel" ADD CONSTRAINT "ContactLabel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLabel" ADD CONSTRAINT "ContactLabel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
