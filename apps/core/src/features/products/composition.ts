import { randomUUID } from "node:crypto";
import { err, map, ok } from "@shared/functional";
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
import OpenAI from "openai";
import { z } from "zod";
import { readImageBytes } from "@core/src/shared/images";
import { getCompanyId } from "@core/src/shared/infrastructure/persistance";
import { identifyProductsInImage, type EmbedImage, type VisualSearch } from "@core/src/features/products/application/identify-products-in-image";
import type { EmbeddingModel, ImageBytes, MatchConfidence, VariantQrCode } from "@core/src/features/products/domain/image-identification";
import { findSellableVariantsByQrCodes, findSellableVariantsOfProduct } from "@core/src/features/products/infrastructure/order-stock";
import { findNearestProductImages } from "@core/src/features/products/infrastructure/product-image-embeddings";
import { readQrCodes } from "@core/src/features/products/infrastructure/qr-code-reader";
import { createOpenAIProductChooser } from "@core/src/features/products/infrastructure/product-matching/openai-product-chooser";
import { MAX_CANDIDATES } from "@core/src/features/products/infrastructure/product-matching/product-chooser";

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

type Env = Readonly<Record<string, string | undefined>>;
type VisualEnv = z.infer<typeof visualEnvSchema>;
type ImageEmbedder = Readonly<{ embedImage: EmbedImage; model: EmbeddingModel }>;
export type ImageEmbedderFactory = (client: OpenAI, env: VisualEnv) => ImageEmbedder | null;

// Unknown provider names or invalid tuning values fail at startup; empty values count as unset.
const visualEnvSchema = z.object({
  PRODUCT_MATCHER_PROVIDER: z.enum(["openai"]).default("openai"),
  PRODUCT_MATCHER_MODEL: z.string().default("gpt-6-luna"),
  IMAGE_EMBEDDER_PROVIDER: z.enum(["openai"]).default("openai"),
  IMAGE_EMBEDDER_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  PRODUCT_MATCH_CANDIDATES: z.coerce.number().int().min(1).max(MAX_CANDIDATES).default(5),
  PRODUCT_MATCH_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  PRODUCT_MATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

// shortcut: no OpenAI image embedder in this branch yet; the coordinator wires T1's createOpenAIImageEmbedder here at merge time.
const openAIImageEmbedder: ImageEmbedderFactory = () => null;

function disabled(reason: "missing_api_key" | "embedder_unavailable") {
  log.info({ event: "product_visual_search_disabled", reason }, "product_visual_search_disabled");
  return null;
}

/** Visual step of the cascade from env, or null (visual_search_disabled) when its provider is not configured. */
export function createVisualSearch(env: Env, createOpenAIEmbedder: ImageEmbedderFactory = openAIImageEmbedder): VisualSearch | null {
  const config = visualEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  if (!config.OPENAI_API_KEY) return disabled("missing_api_key");
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  let embedder: ImageEmbedder | null;
  switch (config.IMAGE_EMBEDDER_PROVIDER) { case "openai": embedder = createOpenAIEmbedder(client, config); }
  if (!embedder) return disabled("embedder_unavailable");
  let chooseProduct: VisualSearch["chooseProduct"];
  switch (config.PRODUCT_MATCHER_PROVIDER) {
    case "openai": chooseProduct = createOpenAIProductChooser({ client, model: config.PRODUCT_MATCHER_MODEL, timeoutMs: config.PRODUCT_MATCH_TIMEOUT_MS, companyId: getCompanyId });
  }
  return { model: embedder.model, embedImage: embedder.embedImage, candidates: config.PRODUCT_MATCH_CANDIDATES,
    minConfidence: config.PRODUCT_MATCH_MIN_CONFIDENCE as MatchConfidence, chooseProduct,
    findNearestProductImages, readImage: readImageBytes, findSellableVariantsOfProduct };
}

const visualSearch = createVisualSearch(process.env);

const identificationDependencies = {
  readQrCodes,
  findVariantsByCodes: async (codes: readonly VariantQrCode[]) => {
    const found = await findSellableVariantsByQrCodes(codes);
    return found.success ? ok(found.data.map((item) => ({ ...item, qrCode: item.qrCode as VariantQrCode }))) : found;
  },
  visual: visualSearch,
};

export const products = {
  create: (input: Parameters<typeof createProduct>[0]) =>
    createProduct(input, { repository: productRepository, findImage, newId: randomUUID, clock: () => new Date() }),
  get: (id: Parameters<typeof getProduct>[0]) =>
    getProduct(id, { repository: productRepository, resolveImage }),
  update: (id: Parameters<typeof updateProduct>[0], input: Parameters<typeof updateProduct>[1]) =>
    updateProduct(id, input, { repository: productRepository, findImage, clock: () => new Date() }),
  list: (input: Parameters<typeof listProducts>[0], options: ListOptions = {}) =>
    listProducts(input, { repository: productRepository, ...(options.includeImages ? { images: listImages } : {}) }),
  identifyProductsInImage: (image: ImageBytes) => identifyProductsInImage(image, identificationDependencies),
};
