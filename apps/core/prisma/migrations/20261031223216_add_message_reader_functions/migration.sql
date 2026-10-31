BEGIN;
SET LOCAL lock_timeout = '5s';

-- Returns only company ids so the retention job can delete per company under RLS.
CREATE FUNCTION public.companies_with_expired_message_traces(p_cutoff timestamptz)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT "companyId" FROM public."MessageTrace" WHERE "expiresAt" <= p_cutoff
  UNION
  SELECT "companyId" FROM public."MessageMaskedText" WHERE "expiresAt" <= p_cutoff
$$;
REVOKE ALL ON FUNCTION public.companies_with_expired_message_traces(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.companies_with_expired_message_traces(timestamptz) TO core_app;

-- Counts only, across companies, of the changes made in the window: no ids, no text. doubt_kind is the kind of the change's doubt reason.
CREATE FUNCTION public.message_change_verdict_counts(p_since timestamptz, p_until timestamptz)
RETURNS TABLE(decision text, doubt_kind text, verdict text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c."decision"::text, c."doubt" ->> 'kind', c."verdict"::text, count(*)
  FROM public."OrderItemChange" c
  WHERE c."createdAt" >= p_since AND c."createdAt" < p_until
  GROUP BY 1, 2, 3
$$;
REVOKE ALL ON FUNCTION public.message_change_verdict_counts(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.message_change_verdict_counts(timestamptz, timestamptz) TO core_app;

COMMIT;
