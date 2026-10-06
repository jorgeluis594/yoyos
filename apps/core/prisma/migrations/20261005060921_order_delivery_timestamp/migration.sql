-- AlterTable
SET lock_timeout = '5s';
ALTER TABLE "Order" ADD COLUMN     "deliveredAt" TIMESTAMP(3);
RESET lock_timeout;

UPDATE "Order" SET "deliveredAt" = "completedAt" WHERE "deliveryStatus" = 'delivered';
