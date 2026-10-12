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

-- The mobile branch now accepts ready images (imageId set, no mime type or size); the Cloud API branch is unchanged.
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_content_image_state_check";
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_content_image_state_check" CHECK (
  (
    "whatsappMessageId" IS NULL
    AND "imageMimeType" IS NULL AND "imageSize" IS NULL
    AND "uploadedByUserId" IS NULL AND "eventDispatchedAt" IS NULL
    AND (
      ("type" = 'text' AND "text" IS NOT NULL AND "caption" IS NULL AND "whatsappMediaId" IS NULL
        AND "imageId" IS NULL AND "imageStatus" IS NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
      OR ("type" = 'image' AND "text" IS NULL AND "whatsappMediaId" IS NOT NULL AND "whatsappMediaId" <> '' AND "imageStatus" IS NOT NULL AND (
        ("imageStatus" = 'ready' AND "imageId" IS NOT NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
        OR ("imageStatus" = 'failed' AND "imageId" IS NULL AND "imageFailureCode" IS NOT NULL AND "imageFailureCode" <> ''
          AND "imageFailureMessage" IS NOT NULL AND "imageFailureMessage" <> '')
      ))
    )
  ) OR (
    "whatsappMessageId" IS NOT NULL AND octet_length("whatsappMessageId") BETWEEN 1 AND 512
    AND octet_length("externalId") BETWEEN 1 AND 4096
    AND "uploadedByUserId" IS NOT NULL AND "uploadedByUserId" <> ''
    AND "userId" IS NULL AND "whatsappMediaId" IS NULL
    AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL
    AND "sentAt" >= TIMESTAMP '1970-01-01' AND "sentAt" <= TIMESTAMP '9999-12-31 23:59:59.999'
    AND ("imageSize" IS NULL OR "imageSize" BETWEEN 0 AND 9007199254740991)
    AND ("imageMimeType" IS NULL OR "imageMimeType" ~ '^image/[A-Za-z0-9!#$&^_.+-]+$')
    AND (
      ("type" = 'text' AND "text" IS NOT NULL AND octet_length("text") BETWEEN 1 AND 65536
        AND "caption" IS NULL AND "imageId" IS NULL AND "imageStatus" IS NULL AND "imageMimeType" IS NULL AND "imageSize" IS NULL)
      OR ("type" = 'image' AND "text" IS NULL AND ("caption" IS NULL OR octet_length("caption") BETWEEN 1 AND 65536)
        AND (
          ("imageStatus" = 'metadata_only' AND "imageId" IS NULL)
          OR ("imageStatus" = 'ready' AND "imageId" IS NOT NULL AND "imageMimeType" IS NULL AND "imageSize" IS NULL)
        ))
    )
  )
) NOT VALID;
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
ALTER TABLE "ChatMessage" VALIDATE CONSTRAINT "ChatMessage_content_image_state_check";
