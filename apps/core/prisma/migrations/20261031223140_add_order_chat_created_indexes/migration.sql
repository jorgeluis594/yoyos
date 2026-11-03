-- Alone in its file and without a function body: CONCURRENTLY cannot run inside a transaction. Each statement is IF NOT EXISTS, so the file can be run again.
-- Both timeouts are reset because the build waits for every older transaction; an inherited timeout would cancel it and leave an INVALID index.
-- Recovery from a failed build: DROP INDEX CONCURRENTLY IF EXISTS "<index>"; prisma migrate resolve --rolled-back <migration>; deploy again.
RESET lock_timeout;
RESET statement_timeout;

-- The messages of an order by date: the message rows of the review. It replaces the prefix index (companyId, orderId), dropped in the next migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderMessage_companyId_orderId_createdAt_idx" ON "OrderMessage"("companyId", "orderId", "createdAt");

-- Arms «Pedido #N cambió»: the messages of an order whose notice closed a cycle.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderMessage_link_change_notice_idx" ON "OrderMessage"("companyId", "orderId", "createdAt") WHERE "linkChangeNotice";

-- The latest order of a chat is a top-1 read. It replaces the prefix index (companyId, chatId), dropped in a later migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_companyId_chatId_createdAt_idx" ON "Order"("companyId", "chatId", "createdAt" DESC);
