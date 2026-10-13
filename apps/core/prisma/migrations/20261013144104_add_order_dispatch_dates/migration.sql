BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "scheduledDispatchDate" DATE,
ADD COLUMN     "shippedAt" TIMESTAMP(3);
COMMIT;
