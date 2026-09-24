BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "Image" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Image_companyId_idx" ON "Image"("companyId");

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Image" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Image" FORCE ROW LEVEL SECURITY;
CREATE POLICY image_company_isolation ON "Image"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
