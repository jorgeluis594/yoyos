-- Returns only company ids so the recovery job can deduct per company under RLS.
-- The predicate is the due-and-fit rule: pending, undeducted, uncancelled orders whose confirmed payments cover the total
-- (or one asked to deduct stock) and whose every item fits the current stock.
CREATE FUNCTION public.list_companies_with_overdue_stock_deductions()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT o."companyId" FROM public."Order" o
  WHERE NOT o."stockDeducted" AND NOT o.cancelled AND o."deliveryStatus" = 'pending'
    AND (
      (SELECT coalesce(sum(p.amount), 0) FROM public."Payment" p
         WHERE p."companyId" = o."companyId" AND p."orderId" = o.id AND p.status = 'confirmed') >= o.total
      OR EXISTS (SELECT 1 FROM public."Payment" p WHERE p."companyId" = o."companyId" AND p."orderId" = o.id
         AND p.status = 'confirmed' AND p."deductStockIfPartial")
    )
    AND NOT EXISTS (SELECT 1 FROM public."OrderItem" i LEFT JOIN public."ProductStock" s ON s."variantId" = i."variantId"
         WHERE i."companyId" = o."companyId" AND i."orderId" = o.id AND coalesce(s.quantity, 0) < i.quantity)
$$;
REVOKE ALL ON FUNCTION public.list_companies_with_overdue_stock_deductions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_companies_with_overdue_stock_deductions() TO core_app;
