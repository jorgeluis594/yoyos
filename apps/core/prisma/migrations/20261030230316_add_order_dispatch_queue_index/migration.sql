-- Alone in its file and without a function body: CONCURRENTLY cannot run inside a transaction.
-- Both timeouts are reset because the build waits for every older transaction; an inherited timeout would cancel it and leave an INVALID index.
-- Recovery from a failed build: DROP INDEX CONCURRENTLY IF EXISTS "Order_dispatch_queue_idx"; prisma migrate resolve --rolled-back <migration>; deploy again.
RESET lock_timeout;
RESET statement_timeout;

-- Pending, uncancelled orders by scheduled dispatch date: the assistant's dispatch queue and its undated count.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_dispatch_queue_idx" ON "Order" ("companyId", "scheduledDispatchDate", number)
  WHERE NOT cancelled AND "deliveryStatus" = 'pending';
