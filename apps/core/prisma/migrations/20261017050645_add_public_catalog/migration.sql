-- Catalog orders have no seller and no chat; existing rows satisfy both checks.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Company" ADD COLUMN "catalogPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "fromCatalog" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "sellerId" DROP NOT NULL;
ALTER TABLE "Order" ADD CONSTRAINT "Order_seller_present" CHECK ("sellerId" IS NOT NULL OR "fromCatalog") NOT VALID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_catalog_without_chat" CHECK (NOT ("fromCatalog" AND "chatId" IS NOT NULL)) NOT VALID;
COMMIT;

-- Validation only scans the table.
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_seller_present";
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_catalog_without_chat";

CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateIndex
CREATE INDEX CONCURRENTLY "Order_fromCatalog_checkoutConfirmedAt_createdAt_idx" ON "Order"("fromCatalog", "checkoutConfirmedAt", "createdAt");
