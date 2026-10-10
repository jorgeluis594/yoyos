SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "CompanyDeliverySettings" ADD COLUMN     "homeEnabled" BOOLEAN NOT NULL DEFAULT false;
