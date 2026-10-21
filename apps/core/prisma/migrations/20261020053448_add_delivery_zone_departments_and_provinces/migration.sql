BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "DeliveryZoneDepartment" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "departmentCode" VARCHAR(2) NOT NULL,
    "zoneId" UUID NOT NULL,

    CONSTRAINT "DeliveryZoneDepartment_pkey" PRIMARY KEY ("companyId","zoneId","departmentCode")
);

-- CreateTable
CREATE TABLE "DeliveryZoneProvince" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "provinceCode" VARCHAR(4) NOT NULL,
    "zoneId" UUID NOT NULL,

    CONSTRAINT "DeliveryZoneProvince_pkey" PRIMARY KEY ("companyId","zoneId","provinceCode")
);

-- AddForeignKey
ALTER TABLE "DeliveryZoneDepartment" ADD CONSTRAINT "DeliveryZoneDepartment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZoneDepartment" ADD CONSTRAINT "DeliveryZoneDepartment_companyId_zoneId_fkey" FOREIGN KEY ("companyId", "zoneId") REFERENCES "DeliveryZone"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeliveryZoneProvince" ADD CONSTRAINT "DeliveryZoneProvince_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZoneProvince" ADD CONSTRAINT "DeliveryZoneProvince_companyId_zoneId_fkey" FOREIGN KEY ("companyId", "zoneId") REFERENCES "DeliveryZone"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DeliveryZoneDepartment"
  ADD CONSTRAINT "DeliveryZoneDepartment_code_check" CHECK ("departmentCode" ~ '^[0-9]{2}$');

ALTER TABLE "DeliveryZoneDepartment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryZoneDepartment" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_zone_department_company_isolation ON "DeliveryZoneDepartment"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "DeliveryZoneProvince"
  ADD CONSTRAINT "DeliveryZoneProvince_code_check" CHECK ("provinceCode" ~ '^[0-9]{4}$');

ALTER TABLE "DeliveryZoneProvince" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryZoneProvince" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_zone_province_company_isolation ON "DeliveryZoneProvince"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

COMMIT;
