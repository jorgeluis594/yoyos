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
  async create(storageKey) {
    try {
      return ok(await prisma.image.create({ data: { storageKey }, select: { id: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to create image record", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to create image record" });
    }
  },
  async find(id) {
    try {
      return ok(await prisma.image.findFirst({ where: { id, OR: [{ sourceKey: null }, { importStatus: "ready" }] }, select: { id: true, storageKey: true, visibility: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to find image record", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find image record" });
    }
  },
  async reserveImport(companyId, sourceKey) {
    try {
      const prior = await prisma.image.findUnique({ where: { companyId_sourceKey: { companyId, sourceKey } }, select: { id: true, storageKey: true } });
      if (prior) return ok(prior);
      const id = crypto.randomUUID();
      const storageKey = `${companyId}/${id}`;
      try {
        await prisma.image.create({ data: { id, companyId, sourceKey, storageKey, visibility: "private", importStatus: "pending" }, select: { id: true } });
        return ok({ id, storageKey });
      } catch (cause) {
        if (!(cause instanceof Prisma.PrismaClientKnownRequestError) || cause.code !== "P2002") throw cause;
        const raced = await prisma.image.findUnique({ where: { companyId_sourceKey: { companyId, sourceKey } }, select: { id: true, storageKey: true } });
        if (raced) return ok(raced);
        throw cause;
      }
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to reserve private image import", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to reserve image import" });
    }
  },
  async completeImport(companyId, id) {
    try {
      await prisma.image.updateMany({ where: { companyId, id, visibility: "private", importStatus: "pending" }, data: { importStatus: "ready", importCompletedAt: new Date() } });
      const image = await prisma.image.findFirst({ where: { companyId, id, importStatus: "ready" }, select: { id: true } });
      return image ? ok(undefined) : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to complete image import" });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to complete private image import", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to complete image import" });
    }
  },
};
