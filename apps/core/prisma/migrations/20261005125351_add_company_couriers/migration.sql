BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "CompanyDeliverySettings" ADD COLUMN     "agencyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CompanyCourier" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "CompanyCourier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyCourier_companyId_idx" ON "CompanyCourier"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyCourier" ADD CONSTRAINT "CompanyCourier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCourier" ADD CONSTRAINT "CompanyCourier_settings_fkey" FOREIGN KEY ("companyId") REFERENCES "CompanyDeliverySettings"("companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyCourier" ADD CONSTRAINT "CompanyCourier_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120);
ALTER TABLE "CompanyCourier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyCourier" FORCE ROW LEVEL SECURITY;
CREATE POLICY courier_company_isolation ON "CompanyCourier"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
