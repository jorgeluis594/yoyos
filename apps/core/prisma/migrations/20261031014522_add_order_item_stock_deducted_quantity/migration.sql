BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "stockDeductedQuantity" BIGINT NOT NULL DEFAULT 0;

-- Orders whose stock was already deducted had all of their quantity deducted.
UPDATE "OrderItem" i SET "stockDeductedQuantity" = i.quantity
  FROM "Order" o WHERE o."companyId" = i."companyId" AND o.id = i."orderId" AND o."stockDeducted";

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_stockDeductedQuantity_check" CHECK ("stockDeductedQuantity" >= 0);

-- Lines with units still to deduct: the waiting and recovery queries of already deducted orders walk it.
CREATE INDEX "OrderItem_stock_unsettled_idx" ON "OrderItem" ("companyId", "variantId", "orderId") WHERE "stockDeductedQuantity" < quantity;

-- Also lists the companies with a deducted order whose lines are not settled yet and could be now.
CREATE OR REPLACE FUNCTION public.list_companies_with_overdue_stock_deductions()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT o."companyId" FROM public."Order" o
  WHERE NOT o.cancelled AND o."deliveryStatus" = 'pending'
    AND ((NOT o."stockDeducted"
      AND (
        (SELECT coalesce(sum(p.amount), 0) FROM public."Payment" p
           WHERE p."companyId" = o."companyId" AND p."orderId" = o.id AND p.status = 'confirmed') >= o.total
        OR EXISTS (SELECT 1 FROM public."Payment" p WHERE p."companyId" = o."companyId" AND p."orderId" = o.id
           AND p.status = 'confirmed' AND p."deductStockIfPartial")
      )
      AND NOT EXISTS (SELECT 1 FROM public."OrderItem" i LEFT JOIN public."ProductStock" s ON s."variantId" = i."variantId"
           WHERE i."companyId" = o."companyId" AND i."orderId" = o.id AND coalesce(s.quantity, 0) < i.quantity))
    OR (o."stockDeducted"
      AND EXISTS (SELECT 1 FROM public."OrderItem" i LEFT JOIN public."ProductStock" s ON s."variantId" = i."variantId"
           WHERE i."companyId" = o."companyId" AND i."orderId" = o.id AND i."stockDeductedQuantity" < i.quantity)
      AND NOT EXISTS (SELECT 1 FROM public."OrderItem" i LEFT JOIN public."ProductStock" s ON s."variantId" = i."variantId"
           WHERE i."companyId" = o."companyId" AND i."orderId" = o.id AND i."stockDeductedQuantity" < i.quantity
             AND coalesce(s.quantity, 0) < i.quantity - i."stockDeductedQuantity")))
$$;
COMMIT;
