import { log } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { getCompanyId, prisma, withLockedForUpdate } from "@core/src/shared/infrastructure/persistance";
import type { WhatsAppContactRepository } from "@core/src/features/contacts/application/ensure-whatsapp-contact";
import { type CustomerId, validWhatsAppLid, type WhatsAppContact } from "@core/src/features/contacts/domain/contact";
import { Prisma } from "@prisma/client";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

type ContactRow = { id: string; whatsappAccountId: string; whatsappLid: string; createdAt: Date; updatedAt: Date };

export function mapWhatsAppContact(contact: ContactRow): WhatsAppContact | null {
  return validWhatsAppLid(contact.whatsappAccountId) && validWhatsAppLid(contact.whatsappLid)
    ? { id: contact.id, whatsappAccountId: contact.whatsappAccountId, whatsappLid: contact.whatsappLid, createdAt: contact.createdAt, updatedAt: contact.updatedAt } : null;
}

export const whatsappContactRepository: WhatsAppContactRepository = {
  async insertIfAbsent(input) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "Contact" ("id", "companyId", "whatsappAccountId", "whatsappLid", "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${input.companyId}::uuid, ${input.whatsappAccountId}, ${input.whatsappLid}, now(), now())
        ON CONFLICT ("companyId", "whatsappAccountId", "whatsappLid") DO NOTHING
      `;
      const contact = await prisma.contact.findFirst({ where: {
        companyId: input.companyId, whatsappAccountId: input.whatsappAccountId, whatsappLid: input.whatsappLid,
      } });
      if (!contact) return err({ code: "INVALID_STORED_DATA", message: "Contact insert was not visible" });
      const mapped = mapWhatsAppContact(contact);
      return mapped ? ok(mapped) : err({ code: "INVALID_STORED_DATA", message: "Invalid contact" });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_ensure_whatsapp_lid_contact", err: cause }, "unable_to_ensure_whatsapp_lid_contact");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to ensure contact" });
    }
  },
};

export type MessageCustomer = Readonly<{ customerId: CustomerId; contactId: string }>;

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type ContactNotFound = Readonly<{ code: "CONTACT_NOT_FOUND"; message: string }>;

type LockedContact = { id: string; customerId: string | null };

/** Requires an active transaction: the row lock serializes concurrent messages of the same contact. */
export async function ensureCustomerForContact(contactId: string): Promise<Result<MessageCustomer, PersistenceError | ContactNotFound>> {
  try {
    return await withLockedForUpdate<LockedContact, Result<MessageCustomer, ContactNotFound>>(
      getCompanyId(),
      Prisma.sql`SELECT "id", "customerId" FROM "Contact" WHERE "id" = ${contactId}::uuid`,
      async (contact) => {
        if (!contact) return err({ code: "CONTACT_NOT_FOUND" as const, message: "Contact not found" });
        const customerId = contact.customerId ?? randomUUID();
        if (!contact.customerId) {
          await prisma.customer.create({ data: { id: customerId, createdAt: new Date() } });
          await prisma.contact.update({ where: { id: contact.id }, data: { customerId } });
        }
        return ok({ customerId: customerId as CustomerId, contactId: contact.id });
      },
    );
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_ensure_customer_for_contact", err: cause }, "unable_to_ensure_customer_for_contact");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to ensure customer" });
  }
}
