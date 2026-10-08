-- The enum statement commits before any CHECK refers to its new value.
ALTER TYPE "MessageImageStatus" ADD VALUE 'metadata_only';

BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Contact"
  ADD COLUMN "whatsappAccountId" VARCHAR(128),
  ADD COLUMN "whatsappLid" VARCHAR(128),
  ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "ChatMessage"
  ADD COLUMN "whatsappMessageId" TEXT,
  ADD COLUMN "imageMimeType" VARCHAR(127),
  ADD COLUMN "imageSize" BIGINT,
  ADD COLUMN "uploadedByUserId" TEXT,
  ADD COLUMN "eventDispatchedAt" TIMESTAMP(3);
COMMIT;

-- Preserve Cloud API uniqueness before dropping its former all-message index.
CREATE UNIQUE INDEX CONCURRENTLY "ChatMessage_cloud_external_id_key"
  ON "ChatMessage"("companyId", "externalId") WHERE "whatsappMessageId" IS NULL;
CREATE UNIQUE INDEX CONCURRENTLY "Contact_companyId_whatsappAccountId_whatsappLid_key"
  ON "Contact"("companyId", "whatsappAccountId", "whatsappLid");
CREATE UNIQUE INDEX CONCURRENTLY "ChatMessage_companyId_chatId_whatsappMessageId_key"
  ON "ChatMessage"("companyId", "chatId", "whatsappMessageId");

BEGIN;
SET LOCAL lock_timeout = '5s';
DROP INDEX "ChatMessage_companyId_externalId_key";
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_phone_nonempty_check";
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_identity_check" CHECK (
  ("phone" IS NULL OR "phone" <> '')
  AND (("whatsappAccountId" IS NULL AND "whatsappLid" IS NULL)
    OR ("whatsappAccountId" IS NOT NULL AND "whatsappAccountId" ~ '^[0-9]+@lid$'
      AND "whatsappLid" IS NOT NULL AND "whatsappLid" ~ '^[0-9]+@lid$'))
  AND ("phone" IS NOT NULL OR "whatsappAccountId" IS NOT NULL)
);
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_content_image_state_check";
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_content_image_state_check" CHECK (
  (
    "whatsappMessageId" IS NULL
    AND "imageMimeType" IS NULL AND "imageSize" IS NULL
    AND "uploadedByUserId" IS NULL AND "eventDispatchedAt" IS NULL
    AND (
      ("type" = 'text' AND "text" IS NOT NULL AND "caption" IS NULL AND "whatsappMediaId" IS NULL
        AND "imageId" IS NULL AND "imageStatus" IS NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
      OR ("type" = 'image' AND "text" IS NULL AND "whatsappMediaId" IS NOT NULL AND "whatsappMediaId" <> '' AND "imageStatus" IS NOT NULL AND (
        ("imageStatus" = 'ready' AND "imageId" IS NOT NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
        OR ("imageStatus" = 'failed' AND "imageId" IS NULL AND "imageFailureCode" IS NOT NULL AND "imageFailureCode" <> ''
          AND "imageFailureMessage" IS NOT NULL AND "imageFailureMessage" <> '')
      ))
    )
  ) OR (
    "whatsappMessageId" IS NOT NULL AND octet_length("whatsappMessageId") BETWEEN 1 AND 512
    AND octet_length("externalId") BETWEEN 1 AND 4096
    AND "uploadedByUserId" IS NOT NULL AND "uploadedByUserId" <> ''
    AND "userId" IS NULL AND "whatsappMediaId" IS NULL AND "imageId" IS NULL
    AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL
    AND "sentAt" >= TIMESTAMP '1970-01-01' AND "sentAt" <= TIMESTAMP '9999-12-31 23:59:59.999'
    AND ("imageSize" IS NULL OR "imageSize" BETWEEN 0 AND 9007199254740991)
    AND ("imageMimeType" IS NULL OR "imageMimeType" ~ '^image/[A-Za-z0-9!#$&^_.+-]+$')
    AND (
      ("type" = 'text' AND "text" IS NOT NULL AND octet_length("text") BETWEEN 1 AND 65536
        AND "caption" IS NULL AND "imageStatus" IS NULL AND "imageMimeType" IS NULL AND "imageSize" IS NULL)
      OR ("type" = 'image' AND "text" IS NULL AND ("caption" IS NULL OR octet_length("caption") BETWEEN 1 AND 65536)
        AND "imageStatus" IS NOT NULL AND "imageStatus" = 'metadata_only')
    )
  )
);
COMMIT;
