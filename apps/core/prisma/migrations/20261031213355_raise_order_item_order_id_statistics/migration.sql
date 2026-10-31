-- ANALYZE samples about 30,000 rows and badly underestimates the distinct values of "OrderItem"."orderId" on a large table (120,869 where there were 1.1 million orders),
-- so the planner believes an order has seven or more items, rejects the index probe on ("companyId", "orderId", "variantId") and reads the whole table to join the
-- items of a 30-day window. A larger sample gives the estimate (a negative n_distinct, a fraction of the rows). It takes effect at the next ANALYZE, which autovacuum runs.
-- Only SHARE UPDATE EXCLUSIVE is taken, so reads and writes continue; the lock wait is bounded. To go back: ALTER TABLE "OrderItem" ALTER COLUMN "orderId" SET STATISTICS -1.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "OrderItem" ALTER COLUMN "orderId" SET STATISTICS 1000;
COMMIT;
