-- Apply with order writes quiesced; the new application allocates numbers transactionally.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Company" ADD COLUMN "nextOrderNumber" BIGINT NOT NULL DEFAULT 1001;
ALTER TABLE "Order" ADD COLUMN "number" BIGINT;
COMMIT;

-- Keep the historical backfill separate from DDL locks and scope every join by company.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
WITH numbered AS (
  SELECT "companyId", "id", 1000 + row_number() OVER (PARTITION BY "companyId" ORDER BY "createdAt", "id") AS number
  FROM "Order"
)
UPDATE "Order" AS o SET "number" = n.number FROM numbered AS n
WHERE o."companyId" = n."companyId" AND o."id" = n."id";
UPDATE "Company" AS c SET "nextOrderNumber" = 1001 + (SELECT count(*) FROM "Order" AS o WHERE o."companyId" = c."id");
COMMIT;

CREATE UNIQUE INDEX CONCURRENTLY "Order_companyId_number_key" ON "Order"("companyId", "number");
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Order" ADD CONSTRAINT "Order_number_valid" CHECK ("number" IS NOT NULL AND "number" BETWEEN 1001 AND 9007199254740991) NOT VALID;
ALTER TABLE "Company" ADD CONSTRAINT "Company_nextOrderNumber_valid" CHECK ("nextOrderNumber" BETWEEN 1001 AND 9007199254740992) NOT VALID;
COMMIT;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_number_valid";
ALTER TABLE "Company" VALIDATE CONSTRAINT "Company_nextOrderNumber_valid";
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Order" ALTER COLUMN "number" SET NOT NULL;
COMMIT;
