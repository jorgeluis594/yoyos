-- When an order was cancelled and when its stock was first deducted. Both are written once and never moved or
-- cleared, so the history of when an order was open for chat messages can be derived from stored times.
-- Nullable columns without a default are a metadata-only change; the locks are bounded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Order" ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN "stockDeductedAt" TIMESTAMPTZ(3);
COMMIT;

-- Development data only: orders already cancelled or with stock deducted read as closed since their creation.
-- Separate from the DDL above, and filtered by the flags so rows already carrying a time are untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

UPDATE "Order" SET "cancelledAt" = "createdAt" WHERE "cancelled" AND "cancelledAt" IS NULL;
UPDATE "Order" SET "stockDeductedAt" = "createdAt" WHERE "stockDeducted" AND "stockDeductedAt" IS NULL;
COMMIT;
