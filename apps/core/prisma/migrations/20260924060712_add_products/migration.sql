BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "imageId" UUID,
    "currency" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "attributes" JSONB NOT NULL,
    "sku" VARCHAR(100),
    "salePrice" DECIMAL(11,2) NOT NULL,
    "purchasePrice" DECIMAL(11,2),
    "qrCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductStock" (
    "variantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProductStock_pkey" PRIMARY KEY ("variantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_qrCode_key" ON "Product"("qrCode");

-- CreateIndex
CREATE INDEX "Product_companyId_idx" ON "Product"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_id_key" ON "Product"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_qrCode_key" ON "ProductVariant"("qrCode");

-- CreateIndex
CREATE INDEX "ProductVariant_companyId_productId_idx" ON "ProductVariant"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_companyId_id_key" ON "ProductVariant"("companyId", "id");

-- CreateIndex
CREATE INDEX "ProductStock_companyId_idx" ON "ProductStock"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStock_companyId_variantId_key" ON "ProductStock"("companyId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Image_companyId_id_key" ON "Image"("companyId", "id");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_imageId_fkey" FOREIGN KEY ("companyId", "imageId") REFERENCES "Image"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStock" ADD CONSTRAINT "ProductStock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStock" ADD CONSTRAINT "ProductStock_companyId_variantId_fkey" FOREIGN KEY ("companyId", "variantId") REFERENCES "ProductVariant"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProductVariant_companyId_sku_normalized_key" ON "ProductVariant" ("companyId", lower(btrim("sku"))) WHERE "sku" IS NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_currency_supported" CHECK ("currency" IN ('PEN', 'USD', 'COP', 'ARS', 'CLP', 'BRL'));
ALTER TABLE "Product" ADD CONSTRAINT "Product_status_active" CHECK ("status" = 'active');
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_sale_price_valid" CHECK ("salePrice" > 0 AND "salePrice" <= 999999999.99);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_purchase_price_valid" CHECK ("purchasePrice" IS NULL OR ("purchasePrice" >= 0 AND "purchasePrice" <= 999999999.99));
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_status_active" CHECK ("status" = 'active');
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_attributes_object" CHECK (jsonb_typeof("attributes") = 'object');
ALTER TABLE "ProductStock" ADD CONSTRAINT "ProductStock_quantity_nonnegative" CHECK ("quantity" >= 0);

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_company_isolation ON "Product"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_variant_company_isolation ON "ProductVariant"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "ProductStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStock" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_stock_company_isolation ON "ProductStock"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
