import { randomUUID } from "node:crypto";
import { getImage } from "@core/src/shared/images/application/images";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import { createProduct } from "./application/create";
import { getProduct } from "./application/get";
import { productRepository } from "./infrastructure/repository";

const imageStorage = createR2ImageStorage({
  endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "",
});

async function resolveImage(companyId: Parameters<typeof getProduct>[0], imageId: NonNullable<Parameters<typeof createProduct>[1]["imageId"]>) {
  const result = await getImage(companyId, imageId, imageStorage, imageRepository);
  if (!result.success) throw new Error(result.error.message);
  return result.data ? { id: result.data.id as typeof imageId, url: result.data.url } : null;
}

export const products = {
  create: (companyId: Parameters<typeof createProduct>[0], input: Parameters<typeof createProduct>[1]) =>
    createProduct(companyId, input, { repository: productRepository, findImage: async (companyId, imageId) => !!(await imageRepository.find(companyId, imageId)), newId: randomUUID, clock: () => new Date() }),
  get: (companyId: Parameters<typeof getProduct>[0], id: Parameters<typeof getProduct>[1]) =>
    getProduct(companyId, id, { repository: productRepository, resolveImage }),
};
