-- Every order is born with its checkout enabled; existing orders, cancelled and completed included, get the same invariant.
SET lock_timeout = '5s';
UPDATE "Order" SET "checkoutEnabledAt" = "createdAt" WHERE "checkoutEnabledAt" IS NULL;
RESET lock_timeout;
