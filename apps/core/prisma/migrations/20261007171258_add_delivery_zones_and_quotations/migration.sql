BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "method" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "priceAmount" DECIMAL(15,2) NOT NULL,
    "priceCurrency" TEXT NOT NULL,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryZoneDistrict" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "method" TEXT NOT NULL,
    "districtCode" VARCHAR(6) NOT NULL,
    "zoneId" UUID NOT NULL,

    CONSTRAINT "DeliveryZoneDistrict_pkey" PRIMARY KEY ("companyId","zoneId","districtCode")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "destination" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRate" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "quotationId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "zoneId" UUID NOT NULL,
    "districtCode" VARCHAR(6) NOT NULL,
    "priceAmount" DECIMAL(15,2) NOT NULL,
    "priceCurrency" TEXT NOT NULL,
    "settingsVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DeliveryRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_companyId_method_id_key" ON "DeliveryZone"("companyId", "method", "id");

-- CreateIndex
CREATE INDEX "DeliveryZoneDistrict_companyId_method_districtCode_idx" ON "DeliveryZoneDistrict"("companyId", "method", "districtCode");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_companyId_id_key" ON "Quotation"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRate_companyId_id_key" ON "DeliveryRate"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRate_companyId_quotationId_zoneId_key" ON "DeliveryRate"("companyId", "quotationId", "zoneId");

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZoneDistrict" ADD CONSTRAINT "DeliveryZoneDistrict_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZoneDistrict" ADD CONSTRAINT "DeliveryZoneDistrict_companyId_method_zoneId_fkey" FOREIGN KEY ("companyId", "method", "zoneId") REFERENCES "DeliveryZone"("companyId", "method", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRate" ADD CONSTRAINT "DeliveryRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRate" ADD CONSTRAINT "DeliveryRate_companyId_quotationId_fkey" FOREIGN KEY ("companyId", "quotationId") REFERENCES "Quotation"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeliveryRate" ADD CONSTRAINT "DeliveryRate_companyId_method_zoneId_fkey" FOREIGN KEY ("companyId", "method", "zoneId") REFERENCES "DeliveryZone"("companyId", "method", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DeliveryZone"
  ADD CONSTRAINT "DeliveryZone_method_check" CHECK ("method" IN ('home', 'agency')),
  ADD CONSTRAINT "DeliveryZone_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "DeliveryZone_price_check" CHECK ("priceAmount" BETWEEN 0 AND 9999999999999.99),
  ADD CONSTRAINT "DeliveryZone_currency_check" CHECK ("priceCurrency" IN ('PEN', 'USD', 'COP', 'ARS', 'CLP', 'BRL'));
ALTER TABLE "DeliveryZoneDistrict"
  ADD CONSTRAINT "DeliveryZoneDistrict_code_check" CHECK ("districtCode" ~ '^[0-9]{6}$');
ALTER TABLE "Quotation"
  ADD CONSTRAINT "Quotation_destination_check" CHECK (
    jsonb_typeof("destination") = 'object'
    AND "destination" ?& ARRAY['country', 'districtCode', 'address', 'instructions']
    AND "destination" - ARRAY['country', 'districtCode', 'address', 'instructions'] = '{}'::jsonb
    AND jsonb_typeof("destination"->'country') = 'string'
    AND "destination"->>'country' = 'PE'
    AND jsonb_typeof("destination"->'districtCode') = 'string'
    AND "destination"->>'districtCode' ~ '^[0-9]{6}$'
    AND jsonb_typeof("destination"->'address') IN ('string', 'null')
    AND jsonb_typeof("destination"->'instructions') IN ('string', 'null')
  );
ALTER TABLE "DeliveryRate"
  ADD CONSTRAINT "DeliveryRate_method_check" CHECK ("method" IN ('home', 'agency')),
  ADD CONSTRAINT "DeliveryRate_code_check" CHECK ("districtCode" ~ '^[0-9]{6}$'),
  ADD CONSTRAINT "DeliveryRate_price_check" CHECK ("priceAmount" BETWEEN 0 AND 9999999999999.99),
  ADD CONSTRAINT "DeliveryRate_currency_check" CHECK ("priceCurrency" IN ('PEN', 'USD', 'COP', 'ARS', 'CLP', 'BRL')),
  ADD CONSTRAINT "DeliveryRate_version_check" CHECK ("settingsVersion" >= 0);

ALTER TABLE "DeliveryZone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryZone" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_zone_company_isolation ON "DeliveryZone"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "DeliveryZoneDistrict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryZoneDistrict" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_zone_district_company_isolation ON "DeliveryZoneDistrict"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "Quotation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Quotation" FORCE ROW LEVEL SECURITY;
CREATE POLICY quotation_company_isolation ON "Quotation"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "DeliveryRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_rate_company_isolation ON "DeliveryRate"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
