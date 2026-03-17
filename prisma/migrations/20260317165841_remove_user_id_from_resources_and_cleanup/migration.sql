/*
  Warnings:

  - You are about to drop the column `userId` on the `ContactLabel` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Flow` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Intent` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Phone` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Promotion` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `ShippingLocation` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Template` table. All the data in the column will be lost.
  - You are about to drop the column `originUserId` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `billingPeriodStart` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `creditsLimit` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `creditsUsed` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `plan` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `whatsappLimit` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `UserSettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ContactLabel" DROP CONSTRAINT "ContactLabel_userId_fkey";

-- DropForeignKey
ALTER TABLE "Phone" DROP CONSTRAINT "Phone_userId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_userId_fkey";

-- DropForeignKey
ALTER TABLE "Promotion" DROP CONSTRAINT "Promotion_userId_fkey";

-- DropForeignKey
ALTER TABLE "ShippingLocation" DROP CONSTRAINT "ShippingLocation_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserSettings" DROP CONSTRAINT "UserSettings_userId_fkey";

-- DropIndex
DROP INDEX "ContactLabel_userId_idx";

-- DropIndex
DROP INDEX "Flow_userId_idx";

-- DropIndex
DROP INDEX "Intent_userId_idx";

-- DropIndex
DROP INDEX "Phone_userId_idx";

-- DropIndex
DROP INDEX "Product_userId_idx";

-- DropIndex
DROP INDEX "Promotion_userId_idx";

-- DropIndex
DROP INDEX "ShippingLocation_userId_idx";

-- DropIndex
DROP INDEX "Template_userId_idx";

-- AlterTable
ALTER TABLE "ContactLabel" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Flow" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Intent" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Phone" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Promotion" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "ShippingLocation" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "originUserId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "billingPeriodStart",
DROP COLUMN "creditsLimit",
DROP COLUMN "creditsUsed",
DROP COLUMN "plan",
DROP COLUMN "role",
DROP COLUMN "whatsappLimit";

-- DropTable
DROP TABLE "UserSettings";

-- DropEnum
DROP TYPE "Role";
