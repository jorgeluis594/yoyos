/*
  Warnings:

  - A unique constraint covering the columns `[companyId,id]` on the table `CompanyCourier` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,id]` on the table `DeliveryZone` will be added. If there are existing duplicate values, this will fail.

*/
BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "CompanyCourier" ADD COLUMN     "courierId" UUID;

-- CreateTable
CREATE TABLE "Courier" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOption" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "zoneId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "priceAmount" DECIMAL(15,2) NOT NULL,
    "priceCurrency" TEXT NOT NULL,

    CONSTRAINT "DeliveryOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAgency" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "districtCode" VARCHAR(6) NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "DeliveryAgency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOptionAgency" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "optionId" UUID NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'agency',
    "agencyId" UUID NOT NULL,

    CONSTRAINT "DeliveryOptionAgency_pkey" PRIMARY KEY ("companyId","optionId","agencyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Courier_code_key" ON "Courier"("code");

-- CreateIndex
CREATE INDEX "DeliveryOption_companyId_zoneId_idx" ON "DeliveryOption"("companyId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOption_companyId_id_key" ON "DeliveryOption"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOption_companyId_method_id_key" ON "DeliveryOption"("companyId", "method", "id");

-- CreateIndex
CREATE INDEX "DeliveryAgency_courierId_idx" ON "DeliveryAgency"("courierId");

-- CreateIndex
CREATE INDEX "DeliveryOptionAgency_companyId_agencyId_idx" ON "DeliveryOptionAgency"("companyId", "agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCourier_companyId_id_key" ON "CompanyCourier"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_companyId_id_key" ON "DeliveryZone"("companyId", "id");

-- AddForeignKey
ALTER TABLE "CompanyCourier" ADD CONSTRAINT "CompanyCourier_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeliveryOption" ADD CONSTRAINT "DeliveryOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOption" ADD CONSTRAINT "DeliveryOption_companyId_zoneId_fkey" FOREIGN KEY ("companyId", "zoneId") REFERENCES "DeliveryZone"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeliveryAgency" ADD CONSTRAINT "DeliveryAgency_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeliveryOptionAgency" ADD CONSTRAINT "DeliveryOptionAgency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOptionAgency" ADD CONSTRAINT "DeliveryOptionAgency_companyId_method_optionId_fkey" FOREIGN KEY ("companyId", "method", "optionId") REFERENCES "DeliveryOption"("companyId", "method", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeliveryOptionAgency" ADD CONSTRAINT "DeliveryOptionAgency_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "DeliveryAgency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "Courier"
  ADD CONSTRAINT "Courier_code_check" CHECK ("code" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  ADD CONSTRAINT "Courier_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120);
ALTER TABLE "DeliveryOption"
  ADD CONSTRAINT "DeliveryOption_method_check" CHECK ("method" IN ('home', 'agency')),
  ADD CONSTRAINT "DeliveryOption_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "DeliveryOption_price_check" CHECK ("priceAmount" BETWEEN 0 AND 9999999999999.99),
  ADD CONSTRAINT "DeliveryOption_currency_check" CHECK ("priceCurrency" IN ('PEN', 'USD', 'COP', 'ARS', 'CLP', 'BRL'));
ALTER TABLE "DeliveryAgency"
  ADD CONSTRAINT "DeliveryAgency_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "DeliveryAgency_address_check" CHECK (length(btrim("address")) BETWEEN 1 AND 500),
  ADD CONSTRAINT "DeliveryAgency_code_check" CHECK ("districtCode" ~ '^[0-9]{6}$');
ALTER TABLE "DeliveryOptionAgency"
  ADD CONSTRAINT "DeliveryOptionAgency_method_check" CHECK ("method" = 'agency');

ALTER TABLE "DeliveryOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOption" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_option_company_isolation ON "DeliveryOption"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "DeliveryOptionAgency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOptionAgency" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_option_agency_company_isolation ON "DeliveryOptionAgency"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

-- Global catalogs: no RLS, read-only for the application role.
REVOKE INSERT, UPDATE, DELETE ON "Courier" FROM core_app;
REVOKE INSERT, UPDATE, DELETE ON "DeliveryAgency" FROM core_app;
COMMIT;
