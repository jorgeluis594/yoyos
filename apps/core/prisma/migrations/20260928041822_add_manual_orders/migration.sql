BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "sellerId" TEXT NOT NULL,
    "contactId" UUID,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "currency" TEXT NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "variantAttributes" JSONB NOT NULL,
    "sku" TEXT,
    "quantity" BIGINT NOT NULL,
    "unitPrice" DECIMAL(11,2) NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_companyId_completedAt_id_idx" ON "Order"("companyId", "completedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Order_companyId_contactId_completedAt_id_idx" ON "Order"("companyId", "contactId", "completedAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_companyId_id_key" ON "Order"("companyId", "id");

-- CreateIndex
CREATE INDEX "OrderItem_companyId_variantId_idx" ON "OrderItem"("companyId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_companyId_orderId_variantId_key" ON "OrderItem"("companyId", "orderId", "variantId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_sellerId_fkey" FOREIGN KEY ("companyId", "sellerId") REFERENCES "user"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_contactId_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "Order"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_companyId_variantId_fkey" FOREIGN KEY ("companyId", "variantId") REFERENCES "ProductVariant"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "Order" ADD CONSTRAINT "Order_currency_supported" CHECK ("currency" IN ('PEN', 'USD', 'COP', 'ARS', 'CLP', 'BRL'));
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_positive" CHECK ("total" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_payment_digital_wallet" CHECK ("paymentMethod" = 'digital_wallet');
ALTER TABLE "Order" ADD CONSTRAINT "Order_contact_snapshot" CHECK (("contactId" IS NULL AND "contactName" IS NULL AND "contactPhone" IS NULL) OR ("contactId" IS NOT NULL AND "contactPhone" IS NOT NULL));
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0 AND "quantity" <= 9007199254740991);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unit_price_positive" CHECK ("unitPrice" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_subtotal_positive" CHECK ("subtotal" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_attributes_object" CHECK (jsonb_typeof("variantAttributes") = 'object' AND NOT jsonb_path_exists("variantAttributes", '$.* ? (@.type() != "string")'));

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_company_isolation ON "Order"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_item_company_isolation ON "OrderItem"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
