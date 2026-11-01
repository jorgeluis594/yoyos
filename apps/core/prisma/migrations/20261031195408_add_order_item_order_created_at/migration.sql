-- The order's creation date copied onto each item, so the last sale of a variant is an index probe on OrderItem.
-- Nullable here: the generated NOT NULL fails on any non-empty database. A later migration repeats the backfill, makes the column
-- NOT NULL and links it to the order with a composite foreign key. Nullable column without a default: metadata-only, the locks are bounded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "OrderItem" ADD COLUMN "orderCreatedAt" TIMESTAMP(3);
COMMIT;

-- Development data only (there is no production data yet), so the backfill is one statement. Separate from the DDL above.
-- The migration role bypasses row-level security, so it filters by company explicitly for correctness, not for access:
-- under the forced policy without app.company_id the UPDATE would silently touch no row.
-- Recovery if this file fails halfway: run this second transaction by hand and `prisma migrate resolve --applied <migration>`
-- (or drop the column and `prisma migrate resolve --rolled-back <migration>`).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

UPDATE "OrderItem" i SET "orderCreatedAt" = o."createdAt"
FROM "Order" o
WHERE o."companyId" = i."companyId" AND o.id = i."orderId" AND i."orderCreatedAt" IS NULL;
COMMIT;
