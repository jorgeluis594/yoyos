import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ImageRepository } from "@core/src/shared/images/application/images";
import { err, ok } from "@shared/functional";
import { Prisma } from "@prisma/client";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

export const imageRepository: ImageRepository = {
  async create(companyId, storageKey) {
    try {
      return ok(await prisma.image.create({ data: { companyId, storageKey }, select: { id: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to create image record", cause);
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to create image record" });
    }
  },
  async find(companyId, id) {
    try {
      return ok(await prisma.image.findFirst({ where: { companyId, id }, select: { id: true, storageKey: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to find image record", cause);
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find image record" });
    }
  },
};
