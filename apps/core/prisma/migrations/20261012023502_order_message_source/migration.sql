-- Message-to-order: customers, order origin chat, processed messages and phone-less buyers.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Contact" ADD COLUMN "customerId" UUID;
ALTER TABLE "Order" ADD COLUMN "chatId" UUID, ADD COLUMN "customerId" UUID;
ALTER TABLE "OrderBuyer" ALTER COLUMN "phone" DROP NOT NULL;

CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderMessage" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "orderId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("companyId","messageId")
);

CREATE UNIQUE INDEX "Customer_companyId_id_key" ON "Customer"("companyId", "id");
CREATE INDEX "OrderMessage_companyId_orderId_idx" ON "OrderMessage"("companyId", "orderId");

-- Tenant isolation is configured in the same transaction that creates the tables.
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_company_isolation ON "Customer"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "OrderMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_message_company_isolation ON "OrderMessage"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "Order"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_companyId_messageId_fkey" FOREIGN KEY ("companyId", "messageId") REFERENCES "ChatMessage"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "Customer"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "Customer"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_chatId_fkey" FOREIGN KEY ("companyId", "chatId") REFERENCES "Chat"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
COMMIT;

-- Indexes on populated tables are built without blocking writes.
CREATE INDEX CONCURRENTLY "Contact_companyId_customerId_idx" ON "Contact"("companyId", "customerId");
CREATE INDEX CONCURRENTLY "Order_companyId_chatId_idx" ON "Order"("companyId", "chatId");

-- Validation scans existing rows without blocking writes.
ALTER TABLE "Customer" VALIDATE CONSTRAINT "Customer_companyId_fkey";
ALTER TABLE "OrderMessage" VALIDATE CONSTRAINT "OrderMessage_companyId_fkey";
ALTER TABLE "OrderMessage" VALIDATE CONSTRAINT "OrderMessage_companyId_orderId_fkey";
ALTER TABLE "OrderMessage" VALIDATE CONSTRAINT "OrderMessage_companyId_messageId_fkey";
ALTER TABLE "Contact" VALIDATE CONSTRAINT "Contact_companyId_customerId_fkey";
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_companyId_customerId_fkey";
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_companyId_chatId_fkey";
