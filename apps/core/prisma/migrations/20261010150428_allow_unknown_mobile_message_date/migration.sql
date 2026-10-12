-- A mobile message may arrive without a date; Cloud API rows (no whatsappMessageId) keep requiring it.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "ChatMessage" ALTER COLUMN "sentAt" DROP NOT NULL;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sentAt_required_outside_mobile_check"
  CHECK ("sentAt" IS NOT NULL OR "whatsappMessageId" IS NOT NULL) NOT VALID;
COMMIT;

-- Existing rows all have a date, so validation only scans the table.
ALTER TABLE "ChatMessage" VALIDATE CONSTRAINT "ChatMessage_sentAt_required_outside_mobile_check";
