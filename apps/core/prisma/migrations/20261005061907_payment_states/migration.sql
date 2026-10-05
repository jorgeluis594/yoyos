SET lock_timeout = '5s';
ALTER TABLE "Payment" ADD COLUMN "status" TEXT, ADD COLUMN "data" JSONB,
  ALTER COLUMN "amount" DROP NOT NULL, ALTER COLUMN "method" DROP NOT NULL;
RESET lock_timeout;

UPDATE "Payment"
SET "status" = 'confirmed',
    "data" = jsonb_build_object(
      'confirmedAt', to_char("recordedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'confirmedBy', jsonb_build_object('kind', 'legacy'),
      'evidence', jsonb_build_object('kind', 'manual'));

SET lock_timeout = '5s';
ALTER TABLE "Payment" ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "data" SET NOT NULL, DROP COLUMN "recordedAt";
RESET lock_timeout;

SET lock_timeout = '5s';
CREATE INDEX "Payment_companyId_orderId_id_idx" ON "Payment"("companyId", "orderId", "id");
RESET lock_timeout;
