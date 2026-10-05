BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "CompanyDeliverySettings" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "storeEnabled" BOOLEAN NOT NULL,
    "pickupName" TEXT,
    "pickupAddress" TEXT,
    "pickupInstructions" TEXT,
    "version" INTEGER NOT NULL,

    CONSTRAINT "CompanyDeliverySettings_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "CompanyDeliverySettings" ADD CONSTRAINT "CompanyDeliverySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyDeliverySettings"
  ADD CONSTRAINT "CompanyDeliverySettings_positive_version" CHECK ("version" > 0),
  ADD CONSTRAINT "CompanyDeliverySettings_complete_pickup" CHECK (
    ("pickupName" IS NULL AND "pickupAddress" IS NULL AND "pickupInstructions" IS NULL AND NOT "storeEnabled")
    OR ("pickupName" IS NOT NULL AND length(btrim("pickupName")) > 0
      AND "pickupAddress" IS NOT NULL AND length(btrim("pickupAddress")) > 0)
  );
ALTER TABLE "CompanyDeliverySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyDeliverySettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_settings_company_isolation ON "CompanyDeliverySettings"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
