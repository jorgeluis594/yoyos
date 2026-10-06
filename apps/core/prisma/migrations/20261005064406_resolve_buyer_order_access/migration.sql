CREATE FUNCTION public.resolve_buyer_order_company(order_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT "companyId" FROM public."Order" WHERE id = order_id
$$;
REVOKE ALL ON FUNCTION public.resolve_buyer_order_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_buyer_order_company(uuid) TO core_app;
