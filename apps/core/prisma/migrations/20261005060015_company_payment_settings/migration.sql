-- CreateTable
CREATE TABLE "CompanyPaymentSettings" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "settings" JSONB NOT NULL,

    CONSTRAINT "CompanyPaymentSettings_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "CompanyPaymentSettings" ADD CONSTRAINT "CompanyPaymentSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyPaymentSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyPaymentSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_payment_settings_isolation ON "CompanyPaymentSettings"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
