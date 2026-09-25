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

export const contactRepository: ContactRepository = {
  async findByPhone(companyId, phone) {
    try {
      return ok(await prisma.contact.findUnique({ where: { companyId_phone: { companyId, phone } } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to find WhatsApp contact", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find contact" });
    }
  },
  async insertIfAbsent(input) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "Contact" ("id", "companyId", "phone", "name", "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${input.companyId}::uuid, ${input.phone}, ${input.name}, now(), now())
        ON CONFLICT ("companyId", "phone") DO NOTHING
      `;
      const contact = await prisma.contact.findUnique({ where: { companyId_phone: { companyId: input.companyId, phone: input.phone } } });
      return contact ? ok(contact) : err({ code: "INVALID_STORED_DATA", message: "Contact insert was not visible" });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to insert WhatsApp contact", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to insert contact" });
    }
  },
  async setName(companyId, contactId, name) {
    try {
      await prisma.contact.updateMany({ where: { companyId, id: contactId }, data: { name } });
      const contact = await prisma.contact.findUnique({ where: { companyId_id: { companyId, id: contactId } } });
      return contact ? ok(contact) : err({ code: "INVALID_STORED_DATA", message: "Contact disappeared while updating name" });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to update WhatsApp contact", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to update contact" });
    }
  },
};
