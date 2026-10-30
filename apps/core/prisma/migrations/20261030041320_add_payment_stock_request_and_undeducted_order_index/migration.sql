BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "deductStockIfPartial" BOOLEAN NOT NULL DEFAULT false;

-- Pending, undeducted, uncancelled orders: the set that waiting-order and recovery queries walk.
CREATE INDEX "Order_undeducted_pending_idx" ON "Order" ("companyId", "createdAt", id)
  WHERE NOT "stockDeducted" AND NOT cancelled AND "deliveryStatus" = 'pending';
COMMIT;
