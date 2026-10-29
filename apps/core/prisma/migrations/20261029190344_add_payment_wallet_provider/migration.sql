SET lock_timeout = '5s';
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "walletProvider" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_wallet_provider_valid"
  CHECK ("walletProvider" IS NULL OR ("method" = 'digital_wallet' AND "walletProvider" IN ('yape', 'plin'))) NOT VALID;
RESET lock_timeout;
ALTER TABLE "Payment" VALIDATE CONSTRAINT "Payment_wallet_provider_valid";
