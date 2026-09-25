BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "ProductStock" ALTER COLUMN "quantity" SET DATA TYPE BIGINT;
COMMIT;
