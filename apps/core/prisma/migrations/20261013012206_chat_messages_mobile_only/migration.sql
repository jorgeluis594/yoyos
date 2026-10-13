-- Chat messages only come from the mobile upload flow. The app is not in production yet,
-- so legacy Cloud API rows and mobile photos stored without an image are deleted, and the
-- table is small enough to rewrite its constraints in one short transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

DELETE FROM "OrderMessage" AS link USING "ChatMessage" AS message
WHERE link."companyId" = message."companyId" AND link."messageId" = message."id"
  AND (message."whatsappMessageId" IS NULL OR message."imageStatus" = 'metadata_only');
DELETE FROM "ChatMessage" WHERE "whatsappMessageId" IS NULL OR "imageStatus" = 'metadata_only';

ALTER TABLE "ChatMessage"
  DROP CONSTRAINT "ChatMessage_content_image_state_check",
  DROP CONSTRAINT "ChatMessage_origin_check",
  DROP CONSTRAINT "ChatMessage_sentAt_required_outside_mobile_check",
  DROP CONSTRAINT "ChatMessage_user_company_fkey";
DROP INDEX "ChatMessage_cloud_external_id_key";

ALTER TABLE "ChatMessage" DROP COLUMN "imageFailureCode",
DROP COLUMN "imageFailureMessage",
DROP COLUMN "imageMimeType",
DROP COLUMN "imageSize",
DROP COLUMN "imageStatus",
DROP COLUMN "userId",
DROP COLUMN "whatsappMediaId",
ALTER COLUMN "whatsappMessageId" SET NOT NULL,
ALTER COLUMN "uploadedByUserId" SET NOT NULL;

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_origin_check" CHECK (
  ("direction" = 'incoming' AND "source" = 'contact') OR ("direction" = 'outgoing' AND "source" = 'seller')
);
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_content_check" CHECK (
  ("type" = 'text' AND "text" IS NOT NULL AND "caption" IS NULL AND "imageId" IS NULL)
  OR ("type" = 'image' AND "text" IS NULL AND "imageId" IS NOT NULL)
);

DROP TYPE "MessageImageStatus";
COMMIT;
