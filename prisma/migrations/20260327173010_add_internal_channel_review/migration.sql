-- CreateEnum
CREATE TYPE "InternalReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "InternalChannelReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "groupJid" TEXT,
    "internalPurpose" TEXT,
    "status" "InternalReviewStatus" NOT NULL DEFAULT 'pending',
    "modifiedPurpose" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalChannelReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalChannelReview_tenantId_idx" ON "InternalChannelReview"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalChannelReview_tenantId_clientId_groupJid_key" ON "InternalChannelReview"("tenantId", "clientId", "groupJid");

-- AddForeignKey
ALTER TABLE "InternalChannelReview" ADD CONSTRAINT "InternalChannelReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalChannelReview" ADD CONSTRAINT "InternalChannelReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
