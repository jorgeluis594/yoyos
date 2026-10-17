import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { err, map, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { applicationEventBus } from "@core/src/composition/event-bus";
import type { EventHandler } from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { getImage, getImages, readImageBytes } from "@core/src/shared/images/application/images";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import { createProduct } from "@core/src/features/products/application/create";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import { indexProductImage, indexProductImagePolicy, type EmbedImage, type IndexProductImageError } from "@core/src/features/products/application/index-product-image";
import type { EmbeddingModel } from "@core/src/features/products/domain/image-identification";
import { findImageIndexState, saveEmbedding } from "@core/src/features/products/infrastructure/product-image-embeddings";
import { createOpenAiImageEmbedder } from "@core/src/features/products/infrastructure/product-matching/openai-image-embedder";
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
  return map(await imageRepository.find(imageId), (image) => image !== null);
}

async function publishProductImageChanged(productId: ProductId) {
  const companyId = getCompanyId() as CompanyId;
  const published = await applicationEventBus().publishEvent("product_image_changed", { companyId, productId });
  if (!published.success) log.error({ event: "product_image_changed_publish_failed", companyId, productId, errorCode: published.error.code }, "product_image_changed_publish_failed");
  return published;
}

export type ImageEmbedder = Readonly<{ model: EmbeddingModel; embedImage: EmbedImage }>;

/** Embedder of the configured provider; null without its key, which disables visual search. Unknown providers fail at startup. */
export function selectImageEmbedder(env: NodeJS.ProcessEnv): ImageEmbedder | null {
  const provider = env.IMAGE_EMBEDDER_PROVIDER || "openai";
  switch (provider) {
    case "openai":
      if (!env.OPENAI_API_KEY) return null;
      return createOpenAiImageEmbedder({
        client: new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: Number(env.PRODUCT_MATCH_TIMEOUT_MS) || 20_000, maxRetries: 0 }),
        describeModel: env.IMAGE_EMBEDDER_MODEL || "gpt-6-luna", currentCompanyId: getCompanyId,
      });
    default:
      throw new Error(`Unknown IMAGE_EMBEDDER_PROVIDER "${provider}"`);
  }
}

export const imageEmbedder = selectImageEmbedder(process.env);

const retryableIndexCodes: readonly IndexProductImageError["code"][] = ["PERSISTENCE_UNAVAILABLE", "IMAGE_STORAGE_UNAVAILABLE", "EMBEDDER_UNAVAILABLE"];

/** Handler of `product_image_changed`: logs each outcome and tells the bus which failures deserve a retry. */
export const indexProductImageHandler: EventHandler<AppEvents, "product_image_changed"> = async (payload, metadata, context) => {
  const started = performance.now();
  const base = { companyId: payload.companyId, productId: payload.productId };
  if (!imageEmbedder) {
    log.debug({ event: "product_image_index_skipped", ...base, reason: "visual_search_disabled" }, "product_image_index_skipped");
    return ok(undefined);
  }
  const result = await withTenantIsolation(payload.companyId, () => indexProductImage({ productId: payload.productId }, {
    findImageIndexState, saveEmbedding, embedImage: imageEmbedder.embedImage, model: imageEmbedder.model,
    readImage: (imageId) => readImageBytes(imageId, imageStorage, imageRepository),
  }));
  if (result.success) {
    const outcome = result.data;
    if (outcome.kind === "indexed") log.info({ event: "product_image_indexed", ...base, imageId: outcome.imageId, model: imageEmbedder.model,
      durationMs: Math.round(performance.now() - started) }, "product_image_indexed");
    else log.debug({ event: "product_image_index_skipped", ...base, reason: outcome.reason }, "product_image_index_skipped");
    return ok(undefined);
  }
  const retryable = retryableIndexCodes.includes(result.error.code);
  // A retryable failure is a warning until the last attempt: then the job stays failed.
  log[retryable && context.attempt <= indexProductImagePolicy.retries ? "warn" : "error"]({ event: "product_image_index_failed", ...base,
    eventId: metadata.eventId, errorCode: result.error.code, retryable, attempt: context.attempt }, "product_image_index_failed");
  return err({ code: result.error.code, message: result.error.message, retryable });
};

export const products = {
  create: (input: Parameters<typeof createProduct>[0]) =>
    createProduct(input, { repository: productRepository, findImage, newId: randomUUID, clock: () => new Date(), publishProductImageChanged }),
  get: (id: Parameters<typeof getProduct>[0]) =>
    getProduct(id, { repository: productRepository, resolveImage }),
  update: (id: Parameters<typeof updateProduct>[0], input: Parameters<typeof updateProduct>[1]) =>
    updateProduct(id, input, { repository: productRepository, findImage, clock: () => new Date(), publishProductImageChanged }),
  list: (input: Parameters<typeof listProducts>[0], options: ListOptions = {}) =>
    listProducts(input, { repository: productRepository, ...(options.includeImages ? { images: listImages } : {}) }),
};
