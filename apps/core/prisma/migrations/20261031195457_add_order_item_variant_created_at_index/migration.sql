-- Alone in its file and without a function body: CONCURRENTLY cannot run inside a transaction.
-- Both timeouts are reset because the build waits for every older transaction; an inherited timeout would cancel it and leave an INVALID index.
-- Recovery from a failed build: DROP INDEX CONCURRENTLY IF EXISTS "OrderItem_companyId_variantId_orderCreatedAt_orderId_idx"; prisma migrate resolve --rolled-back <migration>; deploy again.
-- IF NOT EXISTS keeps an INVALID index left by a failed build and the planner ignores it: check pg_index.indisvalid after deploying.
RESET lock_timeout;
RESET statement_timeout;

-- The last and first sale of a variant: orderId as a fourth key column makes the probes index-only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_companyId_variantId_orderCreatedAt_orderId_idx" ON "OrderItem" ("companyId", "variantId", "orderCreatedAt", "orderId");
