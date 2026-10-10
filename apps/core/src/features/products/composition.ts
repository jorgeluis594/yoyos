import { randomUUID } from "node:crypto";
import { err, map } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { getImage, getImages } from "@core/src/shared/images/application/images";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import { createProduct } from "@core/src/features/products/application/create";
import type { ImageId } from "@core/src/features/products/domain/product";
import { getProduct } from "@core/src/features/products/application/get";
import { listProducts, type ListImageDependencies, type ListImageFailure } from "@core/src/features/products/application/list";
import { updateProduct } from "@core/src/features/products/application/update";
import { productRepository } from "@core/src/features/products/infrastructure/repository";

const imageStorage = createR2ImageStorage({
  endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "",
});

async function resolveImage(imageId: ImageId) {
  const result = await getImage(imageId, imageStorage, imageRepository);
  if (!result.success) {
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: result.error.message });
  }
  return { success: true as const, data: result.data ? { id: result.data.id as typeof imageId, url: result.data.url } : null };
}

async function resolveListImages(imageIds: readonly ImageId[]) {
  return map(await getImages(imageIds, imageStorage, imageRepository), ({ images, failures }) => ({
    images: images.map((image) => ({ id: image.id as ImageId, url: image.url })),
    failures: failures.map(({ id, code, message }) => ({ imageId: id as ImageId, code, message })),
  }));
}

function countByCode(failures: readonly ListImageFailure[]) {
  return failures.reduce<Record<string, number>>((counts, { code }) => ({ ...counts, [code]: (counts[code] ?? 0) + 1 }), {});
}

/** One log entry per listing request, with failure kinds preserved; thumbnails are best effort. */
function reportListImageFailures(failures: readonly ListImageFailure[]) {
  log.error({ event: "product_list_images_unavailable", count: failures.length, codes: countByCode(failures), imageIds: failures.slice(0, 20).map(({ imageId }) => imageId) }, "product_list_images_unavailable");
}

const listImages: ListImageDependencies = { resolve: resolveListImages, report: reportListImageFailures };

export type ListOptions = Readonly<{ includeImages?: boolean }>;

async function findImage(imageId: ImageId) {
  return map(await imageRepository.find(imageId), (image) => image !== null && image.visibility !== "private");
}

export const products = {
  create: (input: Parameters<typeof createProduct>[0]) =>
    createProduct(input, { repository: productRepository, findImage, newId: randomUUID, clock: () => new Date() }),
  get: (id: Parameters<typeof getProduct>[0]) =>
    getProduct(id, { repository: productRepository, resolveImage }),
  update: (id: Parameters<typeof updateProduct>[0], input: Parameters<typeof updateProduct>[1]) =>
    updateProduct(id, input, { repository: productRepository, findImage, clock: () => new Date() }),
  list: (input: Parameters<typeof listProducts>[0], options: ListOptions = {}) =>
    listProducts(input, { repository: productRepository, ...(options.includeImages ? { images: listImages } : {}) }),
};
