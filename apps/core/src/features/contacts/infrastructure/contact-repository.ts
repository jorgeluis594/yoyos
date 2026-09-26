import { randomUUID } from "node:crypto";
import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ContactRepository } from "@core/src/features/contacts/application/ensure-contact";
import { Prisma } from "@prisma/client";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

function mapContact(contact: { id: string; phone: string; name: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: contact.id, phone: contact.phone, name: contact.name, createdAt: contact.createdAt, updatedAt: contact.updatedAt };
}

export const contactRepository: ContactRepository = {
  async findByPhone(phone) {
    try {
      const contact = await prisma.contact.findFirst({ where: { phone } });
      if (!contact) return ok(null);
      return ok(mapContact(contact));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to find WhatsApp contact", { error: cause.name });
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
      return ok(mapContact(contact));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to insert WhatsApp contact", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to insert contact" });
    }
  },
  async setName(contactId, name) {
    try {
      await prisma.contact.updateMany({ where: { id: contactId }, data: { name } });
      const contact = await prisma.contact.findFirst({ where: { id: contactId } });
      if (!contact) return err({ code: "INVALID_STORED_DATA", message: "Contact disappeared while updating name" });
      return ok(mapContact(contact));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to update WhatsApp contact", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to update contact" });
    }
  },
};
