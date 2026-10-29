-- The reader replaces the Decision API step, so `ambiguous_intent` is no longer an outcome kind and its stored rows no longer parse.
-- Development data only: there are no customers or production messages yet.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DELETE FROM "ChatMessageOutcome" WHERE "outcomes" @> '[{"kind":"ambiguous_intent"}]';
COMMIT;
