-- The strict schemas of the staged reader reject the JSON the single reader stored (pendings without doubt fields, outcomes of the old shape).
-- Only development has such rows: there are no customers yet, so they are deleted instead of converted.
-- OrderMessage rows are kept: its new columns are nullable and it remains the already_processed guard.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DELETE FROM "ChatMessageOutcome";
DELETE FROM "ChatPendings";

COMMIT;
