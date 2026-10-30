BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "ChatPendings" ADD COLUMN "lastIncomingPhoto" JSONB;
COMMIT;
