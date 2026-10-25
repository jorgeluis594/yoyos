SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "CompanyDispatchSender" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "name" VARCHAR(120),
    "phone" VARCHAR(30),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyDispatchSender_pkey" PRIMARY KEY ("companyId")
);

-- Tenant isolation
ALTER TABLE "CompanyDispatchSender" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyDispatchSender" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_dispatch_sender_isolation ON "CompanyDispatchSender"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

-- AddForeignKey
ALTER TABLE "CompanyDispatchSender" ADD CONSTRAINT "CompanyDispatchSender_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
