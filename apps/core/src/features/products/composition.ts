import { randomUUID } from "node:crypto";
import { map } from "@shared/functional";
import { getImage } from "@core/src/shared/images/application/images";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import { createProduct } from "@core/src/features/products/application/create";
import { getProduct } from "@core/src/features/products/application/get";
import { listProducts } from "@core/src/features/products/application/list";
import { updateProduct } from "@core/src/features/products/application/update";
import { productRepository } from "@core/src/features/products/infrastructure/repository";

const imageStorage = createR2ImageStorage({
  endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "",
});

async function resolveImage(imageId: NonNullable<Parameters<typeof createProduct>[1]["imageId"]>) {
  const result = await getImage(imageId, imageStorage, imageRepository);
  if (!result.success) throw new Error(result.error.message);
  return result.data ? { id: result.data.id as typeof imageId, url: result.data.url } : null;
}

async function findImage(imageId: NonNullable<Parameters<typeof createProduct>[1]["imageId"]>) {
  return map(await imageRepository.find(imageId), (image) => image !== null);
}

export const products = {
  create: (input: Parameters<typeof createProduct>[0]) =>
    createProduct(input, { repository: productRepository, findImage, newId: randomUUID, clock: () => new Date() }),
  get: (id: Parameters<typeof getProduct>[0]) =>
    getProduct(id, { repository: productRepository, resolveImage }),
  update: (id: Parameters<typeof updateProduct>[0], input: Parameters<typeof updateProduct>[1]) =>
    updateProduct(id, input, { repository: productRepository, findImage, clock: () => new Date() }),
  list: (input: Parameters<typeof listProducts>[0]) =>
    listProducts(input, productRepository),
};
