-- CreateTable
CREATE TABLE "Intent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Intent_userId_idx" ON "Intent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Intent_userId_name_key" ON "Intent"("userId", "name");

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
