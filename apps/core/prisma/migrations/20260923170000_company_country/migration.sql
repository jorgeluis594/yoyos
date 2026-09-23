ALTER TABLE "Company" ADD COLUMN "country" TEXT NOT NULL;
ALTER TABLE "Company" ADD CONSTRAINT "Company_country_check" CHECK ("country" IN ('PE', 'US', 'CO', 'AR', 'CL', 'BR'));
