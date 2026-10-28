BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateTable
CREATE TABLE "ProductPhoto" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "productId" UUID NOT NULL,
    "imageId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProductPhoto_pkey" PRIMARY KEY ("companyId","productId","position"),
    CONSTRAINT "ProductPhoto_position_valid" CHECK ("position" BETWEEN 0 AND 7)
);

-- CreateIndex
CREATE INDEX "ProductPhoto_companyId_imageId_idx" ON "ProductPhoto"("companyId", "imageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPhoto_companyId_productId_imageId_key" ON "ProductPhoto"("companyId", "productId", "imageId");

-- AddForeignKey
ALTER TABLE "ProductPhoto" ADD CONSTRAINT "ProductPhoto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPhoto" ADD CONSTRAINT "ProductPhoto_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPhoto" ADD CONSTRAINT "ProductPhoto_companyId_imageId_fkey" FOREIGN KEY ("companyId", "imageId") REFERENCES "Image"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security, in the same transaction as the table
ALTER TABLE "ProductPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductPhoto" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_photo_company_isolation ON "ProductPhoto"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

-- Each product image becomes its primary photo (position 0), then the column goes away together with its foreign key.
INSERT INTO "ProductPhoto" ("companyId", "productId", "imageId", "position")
SELECT "companyId", "id", "imageId", 0 FROM "Product" WHERE "imageId" IS NOT NULL;

ALTER TABLE "Product" DROP COLUMN "imageId";

COMMIT;
