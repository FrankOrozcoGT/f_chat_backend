-- DropForeignKey
ALTER TABLE "NodeSession" DROP CONSTRAINT "NodeSession_flowId_fkey";

-- AlterTable
ALTER TABLE "NodeSession" ALTER COLUMN "flowId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "NodeSession" ADD CONSTRAINT "NodeSession_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
