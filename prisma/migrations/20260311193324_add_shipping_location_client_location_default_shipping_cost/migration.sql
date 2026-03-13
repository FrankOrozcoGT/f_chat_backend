-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "defaultShippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ShippingLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isFreeShipping" BOOLEAN NOT NULL DEFAULT false,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShippingLocation_userId_idx" ON "ShippingLocation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingLocation_userId_name_key" ON "ShippingLocation"("userId", "name");

-- AddForeignKey
ALTER TABLE "ShippingLocation" ADD CONSTRAINT "ShippingLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
