-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "tenantId" TEXT;

-- CreateIndex
CREATE INDEX "Node_tenantId_idx" ON "Node"("tenantId");

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
