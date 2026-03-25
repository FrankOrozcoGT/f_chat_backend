-- DropForeignKey
ALTER TABLE "Flow" DROP CONSTRAINT "Flow_routerNodeId_fkey";

-- AlterTable
ALTER TABLE "Flow" ALTER COLUMN "routerNodeId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_routerNodeId_fkey" FOREIGN KEY ("routerNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;
