BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "ProductImageEmbedding" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "productId" UUID NOT NULL,
    "imageId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImageEmbedding_pkey" PRIMARY KEY ("companyId","productId","model")
);

-- AddForeignKey
ALTER TABLE "ProductImageEmbedding" ADD CONSTRAINT "ProductImageEmbedding_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProductImageEmbedding" ADD CONSTRAINT "ProductImageEmbedding_companyId_imageId_fkey" FOREIGN KEY ("companyId", "imageId") REFERENCES "Image"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ProductImageEmbedding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImageEmbedding" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_image_embedding_company_isolation ON "ProductImageEmbedding"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

COMMIT;
