-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('user', 'super_admin');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "systemRole" "SystemRole" NOT NULL DEFAULT 'user';
