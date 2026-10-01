BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "Order"
  ADD COLUMN "cancelled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "createdAt" TIMESTAMP(3),
  ADD COLUMN "delivery" JSONB,
  ADD COLUMN "deliveryCharge" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "itemsTotal" DECIMAL(15,2),
  ADD COLUMN "stockDeducted" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "paymentMethod" DROP NOT NULL,
  ALTER COLUMN "completedAt" DROP NOT NULL;

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
  "orderId" UUID NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_companyId_id_key" ON "Payment"("companyId", "id");
CREATE INDEX "Payment_companyId_orderId_recordedAt_id_idx" ON "Payment"("companyId", "orderId", "recordedAt", "id");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "Order"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

UPDATE "Order" SET "createdAt" = "completedAt", "itemsTotal" = "total", "deliveryStatus" = 'delivered', "stockDeducted" = true;
INSERT INTO "Payment" ("id", "companyId", "orderId", "amount", "currency", "method", "recordedAt")
  SELECT gen_random_uuid(), "companyId", "id", "total", "currency", "paymentMethod", "completedAt" FROM "Order";

ALTER TABLE "Order" ALTER COLUMN "createdAt" SET NOT NULL, ALTER COLUMN "itemsTotal" SET NOT NULL;
ALTER TABLE "Order" ADD CONSTRAINT "Order_items_total_positive" CHECK ("itemsTotal" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_delivery_amounts_valid" CHECK ("deliveryCost" >= 0 AND "deliveryCharge" >= 0 AND ("deliveryCharge" = 0 OR "deliveryCharge" = "deliveryCost") AND "total" = "itemsTotal" + "deliveryCharge");
ALTER TABLE "Order" ADD CONSTRAINT "Order_delivery_status_valid" CHECK ("deliveryStatus" IN ('pending', 'shipped', 'delivered'));
ALTER TABLE "Order" ADD CONSTRAINT "Order_dispatched_stock_deducted" CHECK ("deliveryStatus" = 'pending' OR "stockDeducted");
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelled_before_dispatch" CHECK (NOT "cancelled" OR "deliveryStatus" = 'pending');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_currency_supported" CHECK ("currency" IN ('PEN', 'USD', 'COP', 'ARS', 'CLP', 'BRL'));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_method_digital_wallet" CHECK ("method" = 'digital_wallet');

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_company_isolation ON "Payment"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
