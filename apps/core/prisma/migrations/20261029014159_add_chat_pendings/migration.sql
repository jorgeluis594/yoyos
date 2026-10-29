-- Chat pendings: one row per chat with the list of its unfinished product requests.
-- Tenant table: created, constrained and isolated in the same short transaction. The foreign key to "Chat"
-- takes SHARE ROW EXCLUSIVE on it, so lock waits and the statement are bounded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE "ChatPendings" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "chatId" UUID NOT NULL,
    "pendings" JSONB NOT NULL,
    "readyRemembered" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatPendings_pkey" PRIMARY KEY ("companyId","chatId"),
    CONSTRAINT "ChatPendings_pendings_is_array" CHECK (jsonb_typeof("pendings") = 'array')
);

ALTER TABLE "ChatPendings" ADD CONSTRAINT "ChatPendings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatPendings" ADD CONSTRAINT "ChatPendings_companyId_chatId_fkey" FOREIGN KEY ("companyId", "chatId") REFERENCES "Chat"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ChatPendings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatPendings" FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_pendings_company_isolation ON "ChatPendings"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;
