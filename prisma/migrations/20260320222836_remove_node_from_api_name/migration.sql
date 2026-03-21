/*
  Warnings:

  - The values [node] on the enum `ApiName` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ApiName_new" AS ENUM ('qwen_stt', 'kimi_llm', 'qwen_tts');
ALTER TABLE "ApiHealth" ALTER COLUMN "apiName" TYPE "ApiName_new" USING ("apiName"::text::"ApiName_new");
ALTER TYPE "ApiName" RENAME TO "ApiName_old";
ALTER TYPE "ApiName_new" RENAME TO "ApiName";
DROP TYPE "public"."ApiName_old";
COMMIT;
