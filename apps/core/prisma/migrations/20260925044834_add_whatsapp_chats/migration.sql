BEGIN;
SET LOCAL lock_timeout = '5s';

/*
  Warnings:

  - A unique constraint covering the columns `[companyId,sourceKey]` on the table `Image` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,id]` on the table `user` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ImageVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "ImageImportStatus" AS ENUM ('pending', 'ready');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('incoming', 'outgoing');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('contact', 'seller');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'image');

-- CreateEnum
CREATE TYPE "MessageImageStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "MessageImageFailureCode" AS ENUM ('MEDIA_UNAVAILABLE', 'INVALID_IMAGE', 'RETRIES_EXHAUSTED');

-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "importCompletedAt" TIMESTAMP(3),
ADD COLUMN     "importStatus" "ImageImportStatus",
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "visibility" "ImageVisibility" NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "source" "MessageSource" NOT NULL,
    "userId" TEXT,
    "type" "MessageType" NOT NULL,
    "text" TEXT,
    "caption" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "whatsappMediaId" TEXT,
    "imageId" UUID,
    "imageStatus" "MessageImageStatus",
    "imageAttempts" INTEGER,
    "imageNextAttemptAt" TIMESTAMP(3),
    "imageClaimToken" TEXT,
    "imageLeaseUntil" TIMESTAMP(3),
    "imageFailureCode" "MessageImageFailureCode",
    "imageFailureMessage" TEXT,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_id_key" ON "Contact"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_phone_key" ON "Contact"("companyId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_companyId_id_key" ON "Chat"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_companyId_contactId_key" ON "Chat"("companyId", "contactId");

-- CreateIndex
CREATE INDEX "ChatMessage_companyId_chatId_sentAt_id_idx" ON "ChatMessage"("companyId", "chatId", "sentAt", "id");

-- CreateIndex
CREATE INDEX "ChatMessage_companyId_imageStatus_imageNextAttemptAt_idx" ON "ChatMessage"("companyId", "imageStatus", "imageNextAttemptAt");

-- CreateIndex
CREATE INDEX "ChatMessage_companyId_imageStatus_imageLeaseUntil_idx" ON "ChatMessage"("companyId", "imageStatus", "imageLeaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_companyId_id_key" ON "ChatMessage"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_companyId_externalId_key" ON "ChatMessage"("companyId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Image_companyId_sourceKey_key" ON "Image"("companyId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "user_companyId_id_key" ON "user"("companyId", "id");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_companyId_contactId_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_companyId_chatId_fkey" FOREIGN KEY ("companyId", "chatId") REFERENCES "Chat"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_companyId_imageId_fkey" FOREIGN KEY ("companyId", "imageId") REFERENCES "Image"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant and message-state invariants
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_company_isolation ON "Contact"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "Chat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Chat" FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_company_isolation ON "Chat"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_message_company_isolation ON "ChatMessage"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
ALTER TABLE "Image" ADD CONSTRAINT "Image_import_state_check" CHECK (
  ("visibility" = 'public' AND "sourceKey" IS NULL AND "importStatus" IS NULL AND "importCompletedAt" IS NULL)
  OR ("visibility" = 'private' AND "sourceKey" IS NOT NULL AND "sourceKey" <> '' AND "importStatus" = 'pending' AND "importCompletedAt" IS NULL)
  OR ("visibility" = 'private' AND "sourceKey" IS NOT NULL AND "sourceKey" <> '' AND "importStatus" = 'ready' AND "importCompletedAt" IS NOT NULL)
);
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_origin_check" CHECK (
  ("direction" = 'incoming' AND "source" = 'contact' AND "userId" IS NULL)
  OR ("direction" = 'outgoing' AND "source" = 'seller' AND ("userId" IS NULL OR "userId" <> ''))
);
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_phone_nonempty_check" CHECK ("phone" <> '');
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_external_id_nonempty_check" CHECK ("externalId" <> '');
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_user_company_fkey" FOREIGN KEY ("companyId", "userId") REFERENCES "user"("companyId", "id");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_content_image_state_check" CHECK (
  ("type" = 'text' AND "text" IS NOT NULL AND "caption" IS NULL AND "whatsappMediaId" IS NULL AND "imageId" IS NULL
   AND "imageStatus" IS NULL AND "imageAttempts" IS NULL AND "imageNextAttemptAt" IS NULL AND "imageClaimToken" IS NULL
   AND "imageLeaseUntil" IS NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
  OR ("type" = 'image' AND "text" IS NULL AND "whatsappMediaId" IS NOT NULL AND "whatsappMediaId" <> '' AND "imageAttempts" IS NOT NULL AND "imageAttempts" >= 0 AND (
    ("imageStatus" = 'pending' AND "imageNextAttemptAt" IS NOT NULL AND "imageId" IS NULL AND "imageClaimToken" IS NULL AND "imageLeaseUntil" IS NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
    OR ("imageStatus" = 'processing' AND "imageNextAttemptAt" IS NULL AND "imageId" IS NULL AND "imageClaimToken" IS NOT NULL AND "imageClaimToken" <> '' AND "imageLeaseUntil" IS NOT NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
    OR ("imageStatus" = 'ready' AND "imageNextAttemptAt" IS NULL AND "imageId" IS NOT NULL AND "imageClaimToken" IS NULL AND "imageLeaseUntil" IS NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
    OR ("imageStatus" = 'failed' AND "imageNextAttemptAt" IS NULL AND "imageId" IS NULL AND "imageClaimToken" IS NULL AND "imageLeaseUntil" IS NULL AND "imageFailureCode" IS NOT NULL AND "imageFailureMessage" IS NOT NULL AND "imageFailureMessage" <> '')
  ))
);
CREATE INDEX "ChatMessage_pending_image_idx" ON "ChatMessage"("companyId", "imageNextAttemptAt") WHERE "imageStatus" = 'pending';
CREATE INDEX "ChatMessage_expired_image_claim_idx" ON "ChatMessage"("companyId", "imageLeaseUntil") WHERE "imageStatus" = 'processing';

COMMIT;
