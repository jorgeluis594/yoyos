-- Replaces the brand color and background with one fixed theme. The old values are discarded; existing rows
-- take the default theme and keep their logo. One ALTER TABLE keeps the exclusive lock short.
SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "CheckoutTheme" AS ENUM ('classic', 'boutique', 'antojo', 'suave', 'noche');

-- AlterTable
ALTER TABLE "CompanyCheckoutAppearance" DROP COLUMN "background",
DROP COLUMN "brandColor",
ADD COLUMN     "theme" "CheckoutTheme" NOT NULL DEFAULT 'classic';

-- DropEnum
DROP TYPE "CheckoutBrandColor";

-- DropEnum
DROP TYPE "CheckoutBackground";
