-- Private images only came from the removed WhatsApp Cloud API import; nothing else can reference them.
-- The app is not in production yet, so the table is rewritten in one short transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

DELETE FROM "Image" WHERE "visibility" = 'private';
ALTER TABLE "Image" DROP COLUMN "visibility";
DROP TYPE "ImageVisibility";

COMMIT;
