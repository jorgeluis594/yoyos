BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Image" ALTER COLUMN "companyId" SET DEFAULT NULLIF(current_setting('app.company_id', true), '')::uuid;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "companyId" SET DEFAULT NULLIF(current_setting('app.company_id', true), '')::uuid;

-- AlterTable
ALTER TABLE "ProductStock" ALTER COLUMN "companyId" SET DEFAULT NULLIF(current_setting('app.company_id', true), '')::uuid;

-- AlterTable
ALTER TABLE "ProductVariant" ALTER COLUMN "companyId" SET DEFAULT NULLIF(current_setting('app.company_id', true), '')::uuid;
COMMIT;
