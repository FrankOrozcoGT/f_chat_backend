-- DropIndex
DROP INDEX "QueueRequest_instanceName_destinationPhone_status_idx";

-- AlterTable
ALTER TABLE "QueueRequest" ADD COLUMN     "sentWhatsappMessageId" TEXT;

-- CreateIndex
CREATE INDEX "QueueRequest_sentWhatsappMessageId_idx" ON "QueueRequest"("sentWhatsappMessageId");
