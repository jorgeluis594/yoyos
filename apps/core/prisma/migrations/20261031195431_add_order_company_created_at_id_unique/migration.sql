-- Alone in its file and without a function body: CONCURRENTLY cannot run inside a transaction.
-- Both timeouts are reset because the build waits for every older transaction; an inherited timeout would cancel it and leave an INVALID index.
-- Recovery from a failed build: DROP INDEX CONCURRENTLY IF EXISTS "Order_companyId_createdAt_id_key"; prisma migrate resolve --rolled-back <migration>; deploy again.
-- IF NOT EXISTS keeps an INVALID index left by a failed build and the planner ignores it: check pg_index.indisvalid after deploying.
RESET lock_timeout;
RESET statement_timeout;

-- Two jobs with one index write per order insert: the target of the item date foreign key (`id` is already unique, so the build cannot fail on duplicates),
-- and, through its (companyId, createdAt) prefix, the period reads and the created-date search of orders.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Order_companyId_createdAt_id_key" ON "Order" ("companyId", "createdAt", id);
