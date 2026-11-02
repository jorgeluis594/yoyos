-- Whether the seller hides the product from buyers (public catalog and message reading). A constant default is metadata-only:
-- no rewrite, no backfill (existing products stay visible); the lock wait on the most-read table is bounded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Product" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
