-- Orders with payments are never deleted, so their companies are not listed. REPLACE keeps the existing grants.
CREATE OR REPLACE FUNCTION public.list_companies_with_expired_catalog_orders(cutoff timestamptz)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT o."companyId" FROM public."Order" o
  WHERE o."fromCatalog" AND o."checkoutConfirmedAt" IS NULL AND o."createdAt" < cutoff
    AND NOT EXISTS (SELECT 1 FROM public."Payment" p WHERE p."orderId" = o.id)
$$;
