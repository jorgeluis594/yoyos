/*
  Warnings:

  - You are about to drop the column `name` on the `CompanyCourier` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[companyId,courierId]` on the table `CompanyCourier` will be added. If there are existing duplicate values, this will fail.
  - Made the column `courierId` on table `CompanyCourier` required. This step will fail if there are existing NULL values in that column.

*/
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Development data incompatible with catalog couriers; Order snapshots are untouched.
DELETE FROM "CompanyCourier";
UPDATE "CompanyDeliverySettings" SET "agencyEnabled" = false;

-- AlterTable
ALTER TABLE "CompanyCourier" DROP COLUMN "name",
ALTER COLUMN "courierId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCourier_companyId_courierId_key" ON "CompanyCourier"("companyId", "courierId");

COMMIT;
