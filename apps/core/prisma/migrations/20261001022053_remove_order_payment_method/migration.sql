BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o."paymentMethod" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Payment" p
        WHERE p."companyId" = o."companyId" AND p."orderId" = o."id"
          AND p."method" = o."paymentMethod" AND p."amount" = o."total"
      )
  ) THEN
    RAISE EXCEPTION 'Historical order payment method has not been transferred';
  END IF;
END $$;

ALTER TABLE "Order" DROP COLUMN "paymentMethod";
COMMIT;
