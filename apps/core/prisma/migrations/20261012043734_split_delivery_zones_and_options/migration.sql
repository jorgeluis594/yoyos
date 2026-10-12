/*
  Warnings:

  - You are about to drop the column `zoneId` on the `DeliveryRate` table. All the data in the column will be lost.
  - You are about to drop the column `method` on the `DeliveryZone` table. All the data in the column will be lost.
  - You are about to drop the column `priceAmount` on the `DeliveryZone` table. All the data in the column will be lost.
  - You are about to drop the column `priceCurrency` on the `DeliveryZone` table. All the data in the column will be lost.
  - You are about to drop the column `method` on the `DeliveryZoneDistrict` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[companyId,quotationId,optionId]` on the table `DeliveryRate` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `optionId` to the `DeliveryRate` table without a default value. This is not possible if the table is not empty.

*/
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Development zones, quotations and rates predate delivery options; Order snapshots are untouched.
DELETE FROM "DeliveryRate";
DELETE FROM "Quotation";
DELETE FROM "DeliveryZoneDistrict";
DELETE FROM "DeliveryZone";

-- DropForeignKey
ALTER TABLE "DeliveryRate" DROP CONSTRAINT "DeliveryRate_companyId_method_zoneId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryZoneDistrict" DROP CONSTRAINT "DeliveryZoneDistrict_companyId_method_zoneId_fkey";

-- DropIndex
DROP INDEX "DeliveryRate_companyId_quotationId_zoneId_key";

-- DropIndex
DROP INDEX "DeliveryZone_companyId_method_id_key";

-- DropIndex
DROP INDEX "DeliveryZoneDistrict_companyId_method_districtCode_idx";

-- AlterTable
ALTER TABLE "DeliveryRate" DROP COLUMN "zoneId",
ADD COLUMN     "optionId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "DeliveryZone" DROP COLUMN "method",
DROP COLUMN "priceAmount",
DROP COLUMN "priceCurrency";

-- AlterTable
ALTER TABLE "DeliveryZoneDistrict" DROP COLUMN "method";

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRate_companyId_quotationId_optionId_key" ON "DeliveryRate"("companyId", "quotationId", "optionId");

-- CreateIndex
CREATE INDEX "DeliveryZoneDistrict_companyId_districtCode_idx" ON "DeliveryZoneDistrict"("companyId", "districtCode");

-- AddForeignKey
ALTER TABLE "DeliveryZoneDistrict" ADD CONSTRAINT "DeliveryZoneDistrict_companyId_zoneId_fkey" FOREIGN KEY ("companyId", "zoneId") REFERENCES "DeliveryZone"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeliveryRate" ADD CONSTRAINT "DeliveryRate_companyId_method_optionId_fkey" FOREIGN KEY ("companyId", "method", "optionId") REFERENCES "DeliveryOption"("companyId", "method", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DeliveryZone"
  DROP CONSTRAINT IF EXISTS "DeliveryZone_method_check",
  DROP CONSTRAINT IF EXISTS "DeliveryZone_price_check",
  DROP CONSTRAINT IF EXISTS "DeliveryZone_currency_check";
COMMIT;
