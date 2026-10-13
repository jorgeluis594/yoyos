-- Contacts only come from the mobile WhatsApp flow, identified by account and chat LIDs. Phone contacts were
-- created by the removed Cloud API webhook; order buyers keep their own name and phone snapshot.
-- The app is not in production yet, so the tables are rewritten in one short transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "OrderBuyer" AS buyer SET "contactId" = NULL FROM "Contact" AS contact
WHERE buyer."companyId" = contact."companyId" AND buyer."contactId" = contact."id" AND contact."whatsappAccountId" IS NULL;
UPDATE "Order" AS sale SET "chatId" = NULL FROM "Chat" AS chat, "Contact" AS contact
WHERE sale."companyId" = chat."companyId" AND sale."chatId" = chat."id"
  AND chat."companyId" = contact."companyId" AND chat."contactId" = contact."id" AND contact."whatsappAccountId" IS NULL;
DELETE FROM "Chat" AS chat USING "Contact" AS contact
WHERE chat."companyId" = contact."companyId" AND chat."contactId" = contact."id" AND contact."whatsappAccountId" IS NULL;
DELETE FROM "Contact" WHERE "whatsappAccountId" IS NULL;

ALTER TABLE "Contact" DROP CONSTRAINT "Contact_identity_check";
DROP INDEX "Contact_companyId_phone_key";
ALTER TABLE "Contact" DROP COLUMN "name",
DROP COLUMN "phone",
ALTER COLUMN "whatsappAccountId" SET NOT NULL,
ALTER COLUMN "whatsappLid" SET NOT NULL;

COMMIT;
