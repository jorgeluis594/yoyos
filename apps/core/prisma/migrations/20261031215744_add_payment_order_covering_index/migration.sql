-- Alone in its file and without a function body: CONCURRENTLY cannot run inside a transaction.
-- Both timeouts are reset because the build waits for every older transaction; an inherited timeout would cancel it and leave an INVALID index.
-- Recovery from a failed build: DROP INDEX CONCURRENTLY IF EXISTS "Payment_companyId_orderId_covering_idx"; prisma migrate resolve --rolled-back <migration>; deploy again.
RESET lock_timeout;
RESET statement_timeout;

-- The sales summary reads the payments of the orders of a window by order id and needs only these columns: the probes are index-only,
-- so their cost does not depend on the heap pages of the store's payment history. Not expressible in schema.prisma (INCLUDE), like Order_dispatch_queue_idx.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_companyId_orderId_covering_idx" ON "Payment" ("companyId", "orderId") INCLUDE (status, amount, method, "walletProvider");
