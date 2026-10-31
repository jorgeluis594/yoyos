-- Guarantees the item date with the database: an item's (companyId, orderId, orderCreatedAt) must be an existing order's (companyId, id, createdAt),
-- through the unique index Order_companyId_createdAt_id_key of the previous migration. A mismatched value is refused, and an order whose date moves
-- carries its items with it (ON UPDATE CASCADE). The old (companyId, orderId) key is dropped in the same transaction as the new one is added.
--
-- First transaction: all the ACCESS EXCLUSIVE work, bounded by lock_timeout; a timeout rolls the whole group back.
-- The backfill repeats the one of the column migration: the previous app version keeps inserting items with a null date between that migration and this one
-- (and the concurrent index build in between can take long), and this transaction already holds the lock the ALTER TABLE takes.
-- Filtered by company explicitly for correctness: the migration role bypasses row-level security. Development data only (no production data yet).
-- The plain SET NOT NULL scans OrderItem under the lock, chosen on purpose because there is no production data.
-- The foreign key is added NOT VALID, which is still enforced on new and updated rows, so dropping the old key leaves no window without an order check.
-- The drop also takes ACCESS EXCLUSIVE on "Order" for the referential triggers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

UPDATE "OrderItem" i SET "orderCreatedAt" = o."createdAt"
FROM "Order" o
WHERE o."companyId" = i."companyId" AND o.id = i."orderId" AND i."orderCreatedAt" IS NULL;

ALTER TABLE "OrderItem" ALTER COLUMN "orderCreatedAt" SET NOT NULL;

-- Columns follow the order of the referenced unique index (companyId, createdAt, id).
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_companyId_orderId_orderCreatedAt_fkey" FOREIGN KEY ("companyId", "orderCreatedAt", "orderId")
  REFERENCES "Order" ("companyId", "createdAt", id) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;

ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_companyId_orderId_fkey";
COMMIT;

-- Second transaction: validation takes only a share-update-exclusive lock, with its own timeouts.
-- Recovery: a failure here leaves the migration half-applied. Run `ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_companyId_orderId_orderCreatedAt_fkey";`
-- by hand, then `prisma migrate resolve --applied <migration>`.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_companyId_orderId_orderCreatedAt_fkey";
COMMIT;
