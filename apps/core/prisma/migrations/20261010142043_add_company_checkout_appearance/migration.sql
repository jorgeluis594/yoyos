SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "CheckoutBrandColor" AS ENUM ('yoyos', 'forest', 'petrol', 'ocean', 'plum', 'raspberry', 'terracotta', 'mustard', 'graphite');

-- CreateEnum
CREATE TYPE "CheckoutBackground" AS ENUM ('white', 'neutral', 'brand_tint');

-- CreateTable
CREATE TABLE "CompanyCheckoutAppearance" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "logoImageId" UUID,
    "brandColor" "CheckoutBrandColor" NOT NULL,
    "background" "CheckoutBackground" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyCheckoutAppearance_pkey" PRIMARY KEY ("companyId")
);

-- Tenant isolation
ALTER TABLE "CompanyCheckoutAppearance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyCheckoutAppearance" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_checkout_appearance_isolation ON "CompanyCheckoutAppearance"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

-- AddForeignKey
ALTER TABLE "CompanyCheckoutAppearance" ADD CONSTRAINT "CompanyCheckoutAppearance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCheckoutAppearance" ADD CONSTRAINT "CompanyCheckoutAppearance_companyId_logoImageId_fkey" FOREIGN KEY ("companyId", "logoImageId") REFERENCES "Image"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
