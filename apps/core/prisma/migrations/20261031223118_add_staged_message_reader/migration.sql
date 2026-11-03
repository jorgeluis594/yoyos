-- The new tables are created with their row level security in this one transaction; the column additions are nullable or have constant defaults, so they do not rewrite the tables.
-- The indexes of the existing OrderMessage and Order tables are built CONCURRENTLY in the next migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateEnum
CREATE TYPE "OrderItemChangeKind" AS ENUM ('added', 'removed', 'quantity_changed', 'variant_changed', 'mentioned_price_set');

-- CreateEnum
CREATE TYPE "OrderItemChangeDecision" AS ENUM ('applied', 'doubtful');

-- CreateEnum
CREATE TYPE "OrderItemChangeVerdict" AS ENUM ('kept', 'quantity_changed', 'removed', 'undone', 'not_reviewed');

-- CreateEnum
CREATE TYPE "OrderReviewOrigin" AS ENUM ('link', 'detail');

-- CreateEnum
CREATE TYPE "OrderLinkActionKind" AS ENUM ('copy', 'share', 'open');

-- CreateEnum
CREATE TYPE "MessageTraceTextState" AS ENUM ('masked', 'withheld');

-- AlterTable
ALTER TABLE "ChatPendings" ADD COLUMN     "lastIncomingPhoto" JSONB,
ADD COLUMN     "lastRequestAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sellerActedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "OrderMessage" ADD COLUMN     "linkChangeNotice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingsAfter" JSONB,
ADD COLUMN     "pendingsBefore" JSONB,
ADD COLUMN     "undoneAt" TIMESTAMPTZ(3),
ADD COLUMN     "undoneById" TEXT;

-- CreateTable
CREATE TABLE "OrderItemChange" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "orderId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "OrderItemChangeKind" NOT NULL,
    "itemId" UUID,
    "before" JSONB,
    "after" JSONB,
    "decision" "OrderItemChangeDecision" NOT NULL,
    "doubt" JSONB,
    "quoteId" INTEGER,
    "supersededById" UUID,
    "reviewId" UUID,
    "verdict" "OrderItemChangeVerdict",
    "verdictAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReview" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "orderId" UUID NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "origin" "OrderReviewOrigin" NOT NULL,
    "shownPoints" JSONB NOT NULL,
    "correctedItems" INTEGER NOT NULL,
    "changesThrough" INTEGER NOT NULL,
    "confirmedThrough" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLinkAction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "orderId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "OrderLinkActionKind" NOT NULL,
    "reviewId" UUID,
    "takenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderLinkAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTrace" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "messageId" UUID NOT NULL,
    "messageReceivedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "queuedMs" INTEGER NOT NULL,
    "shadowWaitMs" INTEGER,
    "textState" "MessageTraceTextState" NOT NULL,
    "contextMessageIds" UUID[],
    "photo" JSONB,
    "stages" JSONB NOT NULL,
    "quotes" JSONB NOT NULL,
    "decisions" JSONB NOT NULL,
    "shadow" JSONB,
    "costUsd" DECIMAL(12,8),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTrace_pkey" PRIMARY KEY ("companyId","messageId")
);

-- CreateTable
CREATE TABLE "MessageMaskedText" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "messageId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageMaskedText_pkey" PRIMARY KEY ("companyId","messageId")
);

-- CreateTable
CREATE TABLE "MessageTraceRead" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "readerName" TEXT NOT NULL,
    "osUser" TEXT NOT NULL,
    "messageIds" UUID[],
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTraceRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderItemChange_companyId_orderId_createdAt_idx" ON "OrderItemChange"("companyId", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItemChange_companyId_reviewId_idx" ON "OrderItemChange"("companyId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemChange_companyId_messageId_orderId_position_key" ON "OrderItemChange"("companyId", "messageId", "orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemChange_companyId_orderId_seq_key" ON "OrderItemChange"("companyId", "orderId", "seq");

-- CreateIndex
CREATE INDEX "OrderReview_companyId_orderId_confirmedAt_idx" ON "OrderReview"("companyId", "orderId", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderReview_companyId_id_key" ON "OrderReview"("companyId", "id");

-- CreateIndex
CREATE INDEX "OrderLinkAction_companyId_orderId_takenAt_idx" ON "OrderLinkAction"("companyId", "orderId", "takenAt");

-- CreateIndex
CREATE INDEX "MessageTrace_companyId_expiresAt_idx" ON "MessageTrace"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "MessageMaskedText_companyId_expiresAt_idx" ON "MessageMaskedText"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "MessageTraceRead_companyId_readAt_idx" ON "MessageTraceRead"("companyId", "readAt");

-- AddForeignKey
ALTER TABLE "OrderItemChange" ADD CONSTRAINT "OrderItemChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemChange" ADD CONSTRAINT "OrderItemChange_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "Order"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderItemChange" ADD CONSTRAINT "OrderItemChange_companyId_messageId_fkey" FOREIGN KEY ("companyId", "messageId") REFERENCES "ChatMessage"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderItemChange" ADD CONSTRAINT "OrderItemChange_companyId_reviewId_fkey" FOREIGN KEY ("companyId", "reviewId") REFERENCES "OrderReview"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderReview" ADD CONSTRAINT "OrderReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReview" ADD CONSTRAINT "OrderReview_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "Order"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderReview" ADD CONSTRAINT "OrderReview_companyId_reviewedById_fkey" FOREIGN KEY ("companyId", "reviewedById") REFERENCES "user"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderLinkAction" ADD CONSTRAINT "OrderLinkAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLinkAction" ADD CONSTRAINT "OrderLinkAction_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "Order"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderLinkAction" ADD CONSTRAINT "OrderLinkAction_companyId_userId_fkey" FOREIGN KEY ("companyId", "userId") REFERENCES "user"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MessageTrace" ADD CONSTRAINT "MessageTrace_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTrace" ADD CONSTRAINT "MessageTrace_companyId_messageId_fkey" FOREIGN KEY ("companyId", "messageId") REFERENCES "ChatMessage"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MessageMaskedText" ADD CONSTRAINT "MessageMaskedText_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMaskedText" ADD CONSTRAINT "MessageMaskedText_companyId_messageId_fkey" FOREIGN KEY ("companyId", "messageId") REFERENCES "ChatMessage"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MessageTraceRead" ADD CONSTRAINT "MessageTraceRead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints and the partial index of OrderItemChange.
ALTER TABLE "OrderItemChange" ADD CONSTRAINT "OrderItemChange_has_a_line" CHECK ("before" IS NOT NULL OR "after" IS NOT NULL);
ALTER TABLE "OrderItemChange" ADD CONSTRAINT "OrderItemChange_doubt_matches_decision" CHECK (("decision" = 'doubtful') = ("doubt" IS NOT NULL));
ALTER TABLE "OrderItemChange" ADD CONSTRAINT "OrderItemChange_verdict_matches_date" CHECK (("verdict" IS NULL) = ("verdictAt" IS NULL));
-- The unverdicted, unsuperseded changes of an order: marks, the review and the supersede read.
CREATE INDEX "OrderItemChange_open_idx" ON "OrderItemChange"("companyId", "orderId") WHERE "verdict" IS NULL AND "supersededById" IS NULL;

-- Tenant isolation for the new tables.
ALTER TABLE "OrderItemChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItemChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_item_change_company_isolation ON "OrderItemChange"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "OrderReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_review_company_isolation ON "OrderReview"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "OrderLinkAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderLinkAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_link_action_company_isolation ON "OrderLinkAction"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "MessageTrace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageTrace" FORCE ROW LEVEL SECURITY;
CREATE POLICY message_trace_company_isolation ON "MessageTrace"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "MessageMaskedText" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageMaskedText" FORCE ROW LEVEL SECURITY;
CREATE POLICY message_masked_text_company_isolation ON "MessageMaskedText"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "MessageTraceRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageTraceRead" FORCE ROW LEVEL SECURITY;
CREATE POLICY message_trace_read_company_isolation ON "MessageTraceRead"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

COMMIT;
