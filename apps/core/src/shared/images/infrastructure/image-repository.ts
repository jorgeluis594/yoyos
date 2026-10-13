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
      return ok(await prisma.image.findFirst({ where: { id }, select: { id: true, storageKey: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_image_record", err: cause }, "unable_to_find_image_record");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find image record" });
    }
  },
  async findMany(ids) {
    if (!ids.length) return ok([]);
    try {
      return ok(await prisma.image.findMany({ where: { id: { in: [...ids] } }, select: { id: true, storageKey: true } }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_image_records", count: ids.length, err: cause }, "unable_to_find_image_records");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find image records" });
    }
  },
};
