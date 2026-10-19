-- Not in production yet: ProductImageEmbedding rows are dropped, not migrated; products:index-images rebuilds them.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- DropTable
DROP TABLE "ProductImageEmbedding";

-- CreateTable
CREATE TABLE "ImageEmbedding" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "imageId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageEmbedding_pkey" PRIMARY KEY ("companyId","imageId","model")
);

-- AddForeignKey
ALTER TABLE "ImageEmbedding" ADD CONSTRAINT "ImageEmbedding_companyId_imageId_fkey" FOREIGN KEY ("companyId", "imageId") REFERENCES "Image"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImageEmbedding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImageEmbedding" FORCE ROW LEVEL SECURITY;
CREATE POLICY image_embedding_company_isolation ON "ImageEmbedding"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

COMMIT;
