-- Returns only company ids so the cleanup job can delete per company under RLS.
CREATE FUNCTION public.list_companies_with_expired_catalog_orders(cutoff timestamptz)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT "companyId" FROM public."Order"
  WHERE "fromCatalog" AND "checkoutConfirmedAt" IS NULL AND "createdAt" < cutoff
$$;
REVOKE ALL ON FUNCTION public.list_companies_with_expired_catalog_orders(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_companies_with_expired_catalog_orders(timestamptz) TO core_app;
