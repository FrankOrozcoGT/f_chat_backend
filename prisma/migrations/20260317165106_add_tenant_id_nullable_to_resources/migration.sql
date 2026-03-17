-- AlterTable
ALTER TABLE "ContactLabel" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Flow" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Intent" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Phone" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ShippingLocation" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "originUserId" TEXT;

-- CreateTable
CREATE TABLE "TenantSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'free',
    "whatsappLimit" INTEGER NOT NULL DEFAULT 1,
    "creditsLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditsUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analysisMode" "AnalysisMode" NOT NULL DEFAULT 'manual',
    "messageLimit" INTEGER NOT NULL DEFAULT 30,
    "defaultShippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workSchedule" JSONB NOT NULL DEFAULT '{"1":{"start":8,"end":18},"2":{"start":8,"end":18},"3":{"start":8,"end":18},"4":{"start":8,"end":18},"5":{"start":8,"end":18},"6":{"start":8,"end":12}}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantSettings_tenantId_key" ON "TenantSettings"("tenantId");

-- CreateIndex
CREATE INDEX "ContactLabel_tenantId_idx" ON "ContactLabel"("tenantId");

-- CreateIndex
CREATE INDEX "Flow_tenantId_idx" ON "Flow"("tenantId");

-- CreateIndex
CREATE INDEX "Intent_tenantId_idx" ON "Intent"("tenantId");

-- CreateIndex
CREATE INDEX "Phone_tenantId_idx" ON "Phone"("tenantId");

-- CreateIndex
CREATE INDEX "Product_tenantId_idx" ON "Product"("tenantId");

-- CreateIndex
CREATE INDEX "Promotion_tenantId_idx" ON "Promotion"("tenantId");

-- CreateIndex
CREATE INDEX "ShippingLocation_tenantId_idx" ON "ShippingLocation"("tenantId");

-- CreateIndex
CREATE INDEX "Template_tenantId_idx" ON "Template"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phone" ADD CONSTRAINT "Phone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingLocation" ADD CONSTRAINT "ShippingLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLabel" ADD CONSTRAINT "ContactLabel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
