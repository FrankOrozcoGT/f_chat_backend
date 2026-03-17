/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,label]` on the table `ContactLabel` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,name]` on the table `Intent` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,name]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,name]` on the table `ShippingLocation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,tenantId]` on the table `Template` will be added. If there are existing duplicate values, this will fail.
  - Made the column `tenantId` on table `ContactLabel` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Flow` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Intent` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Phone` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Product` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Promotion` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `ShippingLocation` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenantId` on table `Template` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "ContactLabel" DROP CONSTRAINT "ContactLabel_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Flow" DROP CONSTRAINT "Flow_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Intent" DROP CONSTRAINT "Intent_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Phone" DROP CONSTRAINT "Phone_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Promotion" DROP CONSTRAINT "Promotion_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ShippingLocation" DROP CONSTRAINT "ShippingLocation_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_tenantId_fkey";

-- DropIndex
DROP INDEX "ContactLabel_userId_label_key";

-- DropIndex
DROP INDEX "Intent_userId_name_key";

-- DropIndex
DROP INDEX "Product_userId_name_key";

-- DropIndex
DROP INDEX "ShippingLocation_userId_name_key";

-- DropIndex
DROP INDEX "Template_code_userId_key";

-- AlterTable
ALTER TABLE "ContactLabel" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Flow" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Intent" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Phone" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Promotion" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ShippingLocation" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Template" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ContactLabel_tenantId_label_key" ON "ContactLabel"("tenantId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Intent_tenantId_name_key" ON "Intent"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_name_key" ON "Product"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingLocation_tenantId_name_key" ON "ShippingLocation"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Template_code_tenantId_key" ON "Template"("code", "tenantId");

-- AddForeignKey
ALTER TABLE "Phone" ADD CONSTRAINT "Phone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingLocation" ADD CONSTRAINT "ShippingLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLabel" ADD CONSTRAINT "ContactLabel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
