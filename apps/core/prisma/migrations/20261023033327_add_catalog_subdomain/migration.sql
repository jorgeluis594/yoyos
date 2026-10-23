-- Hiding every catalog and adding the CHECK must be atomic, so the column, the constraints and the lookup function stay in this one file.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Company" ADD COLUMN "catalogSubdomain" TEXT;

-- Deploy-time rule: no catalog stays published without a subdomain, and no company has one yet.
UPDATE "Company" SET "catalogPublished" = false WHERE "catalogPublished";

ALTER TABLE "Company" ADD CONSTRAINT "Company_catalogSubdomain_format_check"
  CHECK ("catalogSubdomain" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("catalogSubdomain") BETWEEN 3 AND 30);
ALTER TABLE "Company" ADD CONSTRAINT "Company_catalogPublished_requires_subdomain_check"
  CHECK (NOT "catalogPublished" OR "catalogSubdomain" IS NOT NULL);

CREATE UNIQUE INDEX "Company_catalogSubdomain_key" ON "Company"("catalogSubdomain");

CREATE FUNCTION public.resolve_catalog_subdomain(subdomain text)
RETURNS TABLE (company_id uuid, published boolean, name text, country text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT id, "catalogPublished", name, country FROM public."Company" WHERE "catalogSubdomain" = subdomain
$$;
REVOKE ALL ON FUNCTION public.resolve_catalog_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_catalog_subdomain(text) TO core_app;
COMMIT;
