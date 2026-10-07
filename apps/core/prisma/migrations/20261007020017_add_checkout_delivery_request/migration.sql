SET lock_timeout = '5s';

-- Nullable metadata only; existing order amounts and tenant policies are preserved.
ALTER TABLE "Order" ADD COLUMN     "checkoutDeliveryRequest" JSONB;
