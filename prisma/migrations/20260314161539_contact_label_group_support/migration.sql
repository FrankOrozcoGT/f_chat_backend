-- AlterTable
ALTER TABLE "ContactLabel" ADD COLUMN     "groupJid" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;
