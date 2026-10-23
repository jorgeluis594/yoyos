-- Orders from chat messages: recipient session, mentioned price, message outcomes and push devices.
-- No function bodies, so Prisma runs this file statement by statement without a wrapping transaction:
-- lock_timeout is repeated before every statement that locks an existing table, and each new table is
-- created inside its own explicit transaction together with its row level security.

SET lock_timeout = '5s';
ALTER TABLE "ChatMessage" ADD COLUMN "registeredBySessionId" TEXT;

SET lock_timeout = '5s';
ALTER TABLE "OrderItem" ADD COLUMN "mentionedPriceAmount" DECIMAL(11,2), ADD COLUMN "mentionedPriceUnits" INTEGER;

-- The checks are added NOT VALID (brief lock) and validated later, which only takes SHARE UPDATE EXCLUSIVE.
SET lock_timeout = '5s';
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_mentioned_price_both_or_none"
  CHECK (("mentionedPriceAmount" IS NULL) = ("mentionedPriceUnits" IS NULL)) NOT VALID;

SET lock_timeout = '5s';
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_mentioned_price_amount_positive"
  CHECK ("mentionedPriceAmount" > 0) NOT VALID;

SET lock_timeout = '5s';
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_mentioned_price_units_range"
  CHECK ("mentionedPriceUnits" BETWEEN 1 AND 99) NOT VALID;

SET lock_timeout = '5s';
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_mentioned_price_both_or_none";

SET lock_timeout = '5s';
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_mentioned_price_amount_positive";

SET lock_timeout = '5s';
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_mentioned_price_units_range";

-- Tenant table: created and isolated in the same transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "ChatMessageOutcome" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "messageId" UUID NOT NULL,
    "outcomes" JSONB NOT NULL,
    "noticeSentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageOutcome_pkey" PRIMARY KEY ("companyId","messageId")
);

ALTER TABLE "ChatMessageOutcome" ADD CONSTRAINT "ChatMessageOutcome_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessageOutcome" ADD CONSTRAINT "ChatMessageOutcome_companyId_messageId_fkey" FOREIGN KEY ("companyId", "messageId") REFERENCES "ChatMessage"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "ChatMessageOutcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessageOutcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_message_outcome_company_isolation ON "ChatMessageOutcome"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
COMMIT;

-- Global table, like "session": no row level security. It is read only by session or token.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "PushDevice" (
    "id" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PushDevice_platform_check" CHECK ("platform" IN ('ios', 'android')),
    CONSTRAINT "PushDevice_locale_check" CHECK ("locale" IN ('es', 'pt-BR'))
);

CREATE UNIQUE INDEX "PushDevice_sessionId_key" ON "PushDevice"("sessionId");
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
