BEGIN;
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "Company"
  USING (id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
