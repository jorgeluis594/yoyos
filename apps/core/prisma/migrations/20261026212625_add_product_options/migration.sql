BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- DropIndex
DROP INDEX "ProductVariant_companyId_productId_idx";

-- AlterTable
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_attributes_object";
ALTER TABLE "OrderItem" ALTER COLUMN "variantAttributes" SET DATA TYPE JSON USING "variantAttributes"::json;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_attributes_object" CHECK (json_typeof("variantAttributes") = 'object' AND NOT jsonb_path_exists("variantAttributes"::jsonb, '$.* ? (@.type() != "string")'));

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "structureVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD CONSTRAINT "Product_structureVersion_valid" CHECK ("structureVersion" >= 0);

-- AlterTable
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_attributes_object";
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_status_active";
ALTER TABLE "ProductVariant" DROP COLUMN "attributes",
ADD COLUMN     "combinationKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductVariant" ALTER COLUMN "combinationKey" DROP DEFAULT;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_status_valid" CHECK ("status" IN ('active', 'inactive'));

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "productId" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptionValue" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "optionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantOptionValue" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "productId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "valueId" UUID NOT NULL,

    CONSTRAINT "ProductVariantOptionValue_pkey" PRIMARY KEY ("companyId","variantId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_companyId_productId_id_key" ON "ProductOption"("companyId", "productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOptionValue_companyId_optionId_id_key" ON "ProductOptionValue"("companyId", "optionId", "id");

-- CreateIndex
CREATE INDEX "ProductVariantOptionValue_companyId_optionId_valueId_idx" ON "ProductVariantOptionValue"("companyId", "optionId", "valueId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_companyId_productId_id_key" ON "ProductVariant"("companyId", "productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_companyId_productId_combinationKey_key" ON "ProductVariant"("companyId", "productId", "combinationKey");

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_companyId_productId_optionId_fkey" FOREIGN KEY ("companyId", "productId", "optionId") REFERENCES "ProductOption"("companyId", "productId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_companyId_productId_variantId_fkey" FOREIGN KEY ("companyId", "productId", "variantId") REFERENCES "ProductVariant"("companyId", "productId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_companyId_productId_optionId_fkey" FOREIGN KEY ("companyId", "productId", "optionId") REFERENCES "ProductOption"("companyId", "productId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_companyId_optionId_valueId_fkey" FOREIGN KEY ("companyId", "optionId", "valueId") REFERENCES "ProductOptionValue"("companyId", "optionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Names and positions
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_name_valid" CHECK (char_length(btrim("name")) BETWEEN 1 AND 30 AND "name" = btrim("name"));
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_position_valid" CHECK ("position" >= 0);
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_name_valid" CHECK (char_length(btrim("name")) BETWEEN 1 AND 30 AND "name" = btrim("name"));
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_position_valid" CHECK ("position" >= 0);

-- Tenant isolation
ALTER TABLE "ProductOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductOption" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_option_company_isolation ON "ProductOption"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "ProductOptionValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductOptionValue" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_option_value_company_isolation ON "ProductOptionValue"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "ProductVariantOptionValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariantOptionValue" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_variant_option_value_company_isolation ON "ProductVariantOptionValue"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

COMMIT;
