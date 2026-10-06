SET lock_timeout = '5s';
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_method_digital_wallet";
RESET lock_timeout;
