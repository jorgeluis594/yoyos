/*
  Warnings:

  - You are about to drop the column `checkoutDeliveryRequest` on the `Order` table. All the data in the column will be lost.

*/
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "checkoutDeliveryRequest";
