import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ImageRepository } from "@core/src/shared/images/application/images";

export const imageRepository: ImageRepository = {
  create(companyId, storageKey) {
    return prisma.image.create({ data: { companyId, storageKey }, select: { id: true } });
  },
  find(companyId, id) {
    return prisma.image.findFirst({ where: { companyId, id }, select: { id: true, storageKey: true } });
  },
};
