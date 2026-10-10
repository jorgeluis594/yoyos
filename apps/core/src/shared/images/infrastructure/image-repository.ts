import { log } from "@core/src/shared/infrastructure/logger";
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
      log.error({ event: "unable_to_create_image_record", err: cause }, "unable_to_create_image_record");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to create image record" });
    }
  },
  async find(id) {
    try {
      return ok(await prisma.image.findFirst({ where: { id, OR: [{ sourceKey: null }, { importStatus: "ready" }] }, select: { id: true, storageKey: true, visibility: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_image_record", err: cause }, "unable_to_find_image_record");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find image record" });
    }
  },
  async findMany(ids) {
    if (!ids.length) return ok([]);
    try {
      return ok(await prisma.image.findMany({ where: { id: { in: [...ids] }, OR: [{ sourceKey: null }, { importStatus: "ready" }] }, select: { id: true, storageKey: true, visibility: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_image_records", count: ids.length, err: cause }, "unable_to_find_image_records");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find image records" });
    }
  },
  async findCompletedImport(companyId, sourceKey) {
    try {
      return ok(await prisma.image.findFirst({ where: { companyId, sourceKey, visibility: "private", importStatus: "ready" }, select: { id: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_completed_private_image_import", err: cause }, "unable_to_find_completed_private_image_import");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find completed image import" });
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
      log.error({ event: "unable_to_reserve_private_image_import", err: cause }, "unable_to_reserve_private_image_import");
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
      log.error({ event: "unable_to_complete_private_image_import", err: cause }, "unable_to_complete_private_image_import");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to complete image import" });
    }
  },
};
