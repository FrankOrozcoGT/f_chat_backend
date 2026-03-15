/*
  Warnings:

  - You are about to drop the column `workDays` on the `UserSettings` table. All the data in the column will be lost.
  - You are about to drop the column `workEndHour` on the `UserSettings` table. All the data in the column will be lost.
  - You are about to drop the column `workStartHour` on the `UserSettings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "UserSettings" DROP COLUMN "workDays",
DROP COLUMN "workEndHour",
DROP COLUMN "workStartHour",
ADD COLUMN     "workSchedule" JSONB NOT NULL DEFAULT '{"1":{"start":8,"end":18},"2":{"start":8,"end":18},"3":{"start":8,"end":18},"4":{"start":8,"end":18},"5":{"start":8,"end":18},"6":{"start":8,"end":12}}';
