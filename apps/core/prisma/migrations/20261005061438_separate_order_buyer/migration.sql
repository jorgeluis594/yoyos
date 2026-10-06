-- Stop order writes until migration and matching application deployment finish.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Order" ADD COLUMN "checkoutConfirmedAt" TIMESTAMP(3), ADD COLUMN "checkoutEnabledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD CONSTRAINT "Order_checkout_confirmation_enabled" CHECK ("checkoutConfirmedAt" IS NULL OR "checkoutEnabledAt" IS NOT NULL);
-- CreateTable
CREATE TABLE "OrderBuyer" (
    "orderId" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "contactId" UUID,
    "name" TEXT,
    "phone" TEXT NOT NULL,

    CONSTRAINT "OrderBuyer_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE INDEX "OrderBuyer_companyId_contactId_idx" ON "OrderBuyer"("companyId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBuyer_companyId_orderId_key" ON "OrderBuyer"("companyId", "orderId");

-- AddForeignKey
ALTER TABLE "OrderBuyer" ADD CONSTRAINT "OrderBuyer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBuyer" ADD CONSTRAINT "OrderBuyer_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "Order"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderBuyer" ADD CONSTRAINT "OrderBuyer_companyId_contactId_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "OrderBuyer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderBuyer" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_buyer_company_isolation ON "OrderBuyer"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
INSERT INTO "OrderBuyer" ("orderId", "companyId", "contactId", "name", "phone")
SELECT o."id", o."companyId", o."contactId", o."contactName", o."contactPhone"
FROM "Order" AS o JOIN "Company" AS c ON o."companyId" = c."id"
WHERE o."contactId" IS NOT NULL;
DO $$
DECLARE migrated BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Order" AS o LEFT JOIN "OrderBuyer" AS b ON b."companyId" = o."companyId" AND b."orderId" = o."id"
    WHERE o."contactId" IS NOT NULL AND (b."orderId" IS NULL OR b."contactId" IS DISTINCT FROM o."contactId"
      OR b."name" IS DISTINCT FROM o."contactName" OR b."phone" IS DISTINCT FROM o."contactPhone")
  ) THEN RAISE EXCEPTION 'Order buyer snapshot migration is incomplete'; END IF;
  SELECT count(*) INTO migrated FROM "OrderBuyer";
  RAISE NOTICE 'Order buyer snapshots migrated: %', migrated;
END $$;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Order" DROP CONSTRAINT "Order_companyId_contactId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_contact_snapshot";
DROP INDEX "Order_companyId_contactId_completedAt_id_idx";
ALTER TABLE "Order" DROP COLUMN "contactId", DROP COLUMN "contactName", DROP COLUMN "contactPhone";
COMMIT;
