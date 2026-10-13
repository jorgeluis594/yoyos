-- Private images were only imported by the removed WhatsApp Cloud API webhook. Imports that never
-- completed were hidden from every read and are deleted; completed private images stay readable.
-- The app is not in production yet, so the table is rewritten in one short transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

DELETE FROM "Image" WHERE "importStatus" = 'pending';
ALTER TABLE "Image" DROP CONSTRAINT "Image_import_state_check";
DROP INDEX "Image_companyId_sourceKey_key";
ALTER TABLE "Image" DROP COLUMN "importCompletedAt",
DROP COLUMN "importStatus",
DROP COLUMN "sourceKey";
DROP TYPE "ImageImportStatus";

COMMIT;
