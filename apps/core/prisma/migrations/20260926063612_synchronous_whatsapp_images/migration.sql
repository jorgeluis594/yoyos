BEGIN;
SET LOCAL lock_timeout = '5s';

-- Messages left by the old worker cannot be resumed after removing it.
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_content_image_state_check";
UPDATE "ChatMessage"
SET "imageStatus" = 'failed',
    "imageFailureCode" = 'MEDIA_UNAVAILABLE',
    "imageFailureMessage" = 'Image import was interrupted'
WHERE "imageStatus" IN ('pending', 'processing');

DROP INDEX IF EXISTS "ChatMessage_pending_image_idx";
DROP INDEX IF EXISTS "ChatMessage_expired_image_claim_idx";
DROP INDEX IF EXISTS "ChatMessage_companyId_imageStatus_imageNextAttemptAt_idx";
DROP INDEX IF EXISTS "ChatMessage_companyId_imageStatus_imageLeaseUntil_idx";

CREATE TYPE "MessageImageStatus_new" AS ENUM ('ready', 'failed');
ALTER TABLE "ChatMessage" ALTER COLUMN "imageStatus" TYPE "MessageImageStatus_new" USING ("imageStatus"::text::"MessageImageStatus_new");
ALTER TYPE "MessageImageStatus" RENAME TO "MessageImageStatus_old";
ALTER TYPE "MessageImageStatus_new" RENAME TO "MessageImageStatus";
DROP TYPE "MessageImageStatus_old";

ALTER TABLE "ChatMessage" ALTER COLUMN "imageFailureCode" TYPE TEXT USING ("imageFailureCode"::text);
DROP TYPE "MessageImageFailureCode";
ALTER TABLE "ChatMessage"
  DROP COLUMN "imageAttempts",
  DROP COLUMN "imageClaimToken",
  DROP COLUMN "imageLeaseUntil",
  DROP COLUMN "imageNextAttemptAt";

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_content_image_state_check" CHECK (
  ("type" = 'text' AND "text" IS NOT NULL AND "caption" IS NULL AND "whatsappMediaId" IS NULL
   AND "imageId" IS NULL AND "imageStatus" IS NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
  OR ("type" = 'image' AND "text" IS NULL AND "whatsappMediaId" IS NOT NULL AND "whatsappMediaId" <> '' AND (
    ("imageStatus" = 'ready' AND "imageId" IS NOT NULL AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL)
    OR ("imageStatus" = 'failed' AND "imageId" IS NULL AND "imageFailureCode" IS NOT NULL AND "imageFailureCode" <> ''
        AND "imageFailureMessage" IS NOT NULL AND "imageFailureMessage" <> '')
  ))
);

COMMIT;
