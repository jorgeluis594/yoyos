BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Chat" ALTER COLUMN "companyId" SET DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "ChatMessage" ALTER COLUMN "companyId" SET DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "companyId" SET DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid;

COMMIT;
