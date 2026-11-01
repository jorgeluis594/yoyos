-- Alone in its file, and the only statement: Prisma runs a file with several statements in one transaction unless they are CREATE INDEX CONCURRENTLY,
-- and DROP INDEX CONCURRENTLY cannot run inside a transaction block. A fresh migration connection has no lock or statement timeout to reset.
-- The dropped index is the prefix of OrderItem_companyId_variantId_orderCreatedAt_orderId_idx, which serves the foreign key to ProductVariant and findOrderedVariantIds.
-- To go back, recreate it with CREATE INDEX CONCURRENTLY IF NOT EXISTS on ("companyId", "variantId") and run: prisma migrate resolve --rolled-back <migration>.
DROP INDEX CONCURRENTLY IF EXISTS "OrderItem_companyId_variantId_idx";
