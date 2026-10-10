SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

RESET lock_timeout;

-- CreateIndex
CREATE INDEX CONCURRENTLY "Product_name_idx" ON "Product" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX CONCURRENTLY "ProductVariant_sku_idx" ON "ProductVariant" USING GIN ("sku" gin_trgm_ops);
