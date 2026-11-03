-- One statement only: Prisma wraps a multi-statement file in a transaction, and DROP INDEX CONCURRENTLY cannot run inside one.
-- Replaced by "Order_companyId_chatId_createdAt_idx", whose prefix it was.
DROP INDEX CONCURRENTLY IF EXISTS "Order_companyId_chatId_idx";
