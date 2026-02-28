/*
  Warnings:

  - You are about to drop the column `clientId` on the `Conversation` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_clientId_fkey";

-- DropIndex
DROP INDEX "Conversation_clientId_idx";

-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "clientId";
