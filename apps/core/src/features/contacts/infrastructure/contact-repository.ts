import { log } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ContactRepository } from "@core/src/features/contacts/application/ensure-contact";
import type { WhatsAppContactRepository } from "@core/src/features/contacts/application/ensure-whatsapp-contact";
import { normalizePhone, validWhatsAppLid, type PhoneContact, type WhatsAppContact } from "@core/src/features/contacts/domain/contact";
import { Prisma } from "@prisma/client";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

type ContactRow = { id: string; phone: string | null; whatsappAccountId: string | null; whatsappLid: string | null; name: string | null; createdAt: Date; updatedAt: Date };

function mapPhoneContact(contact: ContactRow): PhoneContact | null {
  const validPair = (contact.whatsappAccountId === null && contact.whatsappLid === null)
    || (contact.whatsappAccountId !== null && contact.whatsappLid !== null
      && validWhatsAppLid(contact.whatsappAccountId) && validWhatsAppLid(contact.whatsappLid));
  return contact.phone && normalizePhone(contact.phone) && validPair ? { ...contact, phone: contact.phone } : null;
}

function mapWhatsAppContact(contact: ContactRow): WhatsAppContact | null {
  return (contact.phone === null || normalizePhone(contact.phone)) && contact.whatsappAccountId && contact.whatsappLid
    && validWhatsAppLid(contact.whatsappAccountId) && validWhatsAppLid(contact.whatsappLid)
    ? { ...contact, whatsappAccountId: contact.whatsappAccountId, whatsappLid: contact.whatsappLid } : null;
}

export const contactRepository: ContactRepository = {
  async findByPhone(phone) {
    try {
      const contact = await prisma.contact.findFirst({ where: { phone } });
      if (!contact) return ok(null);
      const mapped = mapPhoneContact(contact);
      return mapped ? ok(mapped) : err({ code: "INVALID_STORED_DATA", message: "Invalid contact" });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_whatsapp_contact", err: cause }, "unable_to_find_whatsapp_contact");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find contact" });
    }
  },
  async insertIfAbsent(input) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "Contact" ("id", "phone", "name", "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${input.phone}, ${input.name}, now(), now())
        ON CONFLICT ("companyId", "phone") DO NOTHING
      `;
      const contact = await prisma.contact.findFirst({ where: { phone: input.phone } });
      if (!contact) return err({ code: "INVALID_STORED_DATA", message: "Contact insert was not visible" });
      const mapped = mapPhoneContact(contact);
      return mapped ? ok(mapped) : err({ code: "INVALID_STORED_DATA", message: "Invalid contact" });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_insert_whatsapp_contact", err: cause }, "unable_to_insert_whatsapp_contact");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to insert contact" });
    }
  },
  async setName(contactId, name) {
    try {
      await prisma.contact.updateMany({ where: { id: contactId }, data: { name } });
      const contact = await prisma.contact.findFirst({ where: { id: contactId } });
      if (!contact) return err({ code: "INVALID_STORED_DATA", message: "Contact disappeared while updating name" });
      const mapped = mapPhoneContact(contact);
      return mapped ? ok(mapped) : err({ code: "INVALID_STORED_DATA", message: "Invalid contact" });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_update_whatsapp_contact", err: cause }, "unable_to_update_whatsapp_contact");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to update contact" });
    }
  },
};

export const whatsappContactRepository: WhatsAppContactRepository = {
  async insertIfAbsent(input) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "Contact" ("id", "companyId", "phone", "name", "whatsappAccountId", "whatsappLid", "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${input.companyId}::uuid, NULL, NULL, ${input.whatsappAccountId}, ${input.whatsappLid}, now(), now())
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

export async function findContactById(id: string) {
  try {
    const contact = await prisma.contact.findFirst({ where: { id, phone: { not: null } }, select: { id: true, name: true, phone: true } });
    return ok(contact?.phone ? { ...contact, phone: contact.phone } : null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_sale_contact", err: cause }, "unable_to_find_sale_contact");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to find contact" });
  }
}

export async function searchSaleContacts(search: string) {
  try {
    const contacts = await prisma.contact.findMany({ where: { phone: { not: null }, OR: [
      { name: { contains: search.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } },
      { phone: { contains: search.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } },
    ] }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, phone: true } });
    return ok(contacts.filter((contact): contact is { id: string; name: string | null; phone: string } => contact.phone !== null));
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_search_sale_contacts", err: cause }, "unable_to_search_sale_contacts");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to search contacts" });
  }
}
