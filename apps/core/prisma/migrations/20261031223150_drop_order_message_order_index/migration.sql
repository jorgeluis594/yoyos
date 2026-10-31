-- One statement only: Prisma wraps a multi-statement file in a transaction, and DROP INDEX CONCURRENTLY cannot run inside one.
-- Replaced by "OrderMessage_companyId_orderId_createdAt_idx", whose prefix it was.
DROP INDEX CONCURRENTLY IF EXISTS "OrderMessage_companyId_orderId_idx";
