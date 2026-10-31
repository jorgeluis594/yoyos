import OpenAI from "openai";
import { err, map, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { applicationEventBus } from "@core/src/composition/event-bus";
import type { EventHandler } from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { getImages, readImageBytes } from "@core/src/shared/images/application/images";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import { indexProductPhotos, indexProductPhotosPolicy, type EmbedImage, type PhotoIndexFailure } from "@core/src/features/products/application/index-product-photos";
import type { EmbeddingModel } from "@core/src/features/products/domain/image-identification";
import { findPhotoIndexState, saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import { createOpenAiImageEmbedder } from "@core/src/features/products/infrastructure/product-matching/openai-image-embedder";
import { createLocalImageEmbedder, DEFAULT_LOCAL_IMAGE_MODEL } from "@core/src/features/products/infrastructure/product-matching/local-image-embedder";
import type { ListImageDependencies, ListImageFailure } from "@core/src/features/products/application/list";
import { z } from "zod";
import { identifyProductsInImage, type VisualSearch } from "@core/src/features/products/application/identify-products-in-image";
import type { ImageBytes, MatchConfidence, VariantQrCode } from "@core/src/features/products/domain/image-identification";
import { findOfferedVariants, findSellableVariantsByQrCodes } from "@core/src/features/products/infrastructure/order-stock";
import { findNearestProductImages, hasIndexedProducts } from "@core/src/features/products/infrastructure/image-embeddings";
import { readQrCodes } from "@core/src/shared/images/infrastructure/qr-code-reader";
import { brightenDimPhoto } from "@core/src/features/products/infrastructure/product-matching/dim-photo";
import { cropPostPhoto } from "@core/src/features/products/infrastructure/product-matching/post-photo";
import { createOpenAIProductChooser } from "@core/src/features/products/infrastructure/product-matching/openai-product-chooser";
import { MAX_CANDIDATES } from "@core/src/features/products/infrastructure/product-matching/product-chooser";
import { findCatalogProduct, listCatalogProducts } from "@core/src/features/products/application/catalog-products";
import { catalogProductRepository } from "@core/src/features/products/infrastructure/catalog-products-repository";
import { findVariantPhotos } from "@core/src/features/products/application/variant-photos";
import { findVariantImages } from "@core/src/features/products/infrastructure/variant-photo-repository";
import type { VariantId } from "@core/src/features/products/domain/product";
import { catalogSearchReadiness } from "@core/src/features/products/application/catalog-search-readiness";
import { hasActiveProducts } from "@core/src/features/products/infrastructure/catalog-search-readiness";
import { findProductsForReading } from "@core/src/features/products/application/find-products-for-reading";
import { findMessageCandidates } from "@core/src/features/products/application/find-message-candidates";
import { readProductRowsForReading } from "@core/src/features/products/infrastructure/reading-products";
import { searchProductsByCoverage } from "@core/src/features/products/infrastructure/text-candidates";
import { defaultTextMatchLimits } from "@core/src/features/products/domain/message-words";
import type { AppError, Result } from "@shared/result";
import { searchForAssistant, type AssistantProductSearch } from "@core/src/features/products/application/search-for-assistant";
import { findForAssistant, type AssistantProductReference } from "@core/src/features/products/application/find-for-assistant";
import { assistantSnapshot, type AssistantReadError, type AssistantReadOperation } from "@core/src/features/products/infrastructure/assistant-read";

export type { AssistantReadOperation };
import { findSkuOwner, readVocabulary, searchPage } from "@core/src/features/products/infrastructure/product-search-repository";
import { readProductInSnapshot } from "@core/src/features/products/infrastructure/repository";

const imageStorage = createR2ImageStorage({
  endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "",
});

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

export const listImages: ListImageDependencies = { resolve: resolveListImages, report: reportListImageFailures };

/** The ids of these images that exist for the company (RLS), in one query. */
export async function findImages(imageIds: readonly ImageId[]) {
  return map(await imageRepository.findMany(imageIds), (images) => new Set(images.map((image) => image.id as ImageId)) as ReadonlySet<ImageId>);
}

export async function publishProductPhotosAdded(productId: ProductId) {
  const companyId = getCompanyId() as CompanyId;
  const published = await applicationEventBus().publishEvent("product_photos_added", { companyId, productId });
  if (!published.success) log.error({ event: "product_photos_added_publish_failed", companyId, productId, errorCode: published.error.code, err: published.error }, "product_photos_added_publish_failed");
  return published;
}

type Env = Readonly<Record<string, string | undefined>>;
export type ImageEmbedder = Readonly<{ model: EmbeddingModel; embedImage: EmbedImage }>;
export type VisualSearchSetup = Readonly<{ embedder: ImageEmbedder | null; visual: VisualSearch | null }>;

// Unknown provider names or invalid tuning values fail at startup; empty values count as unset.
const visualEnvSchema = z.object({
  PRODUCT_MATCHER_PROVIDER: z.enum(["openai"]).default("openai"),
  PRODUCT_MATCHER_MODEL: z.string().default("gpt-6-luna"),
  IMAGE_EMBEDDER_PROVIDER: z.enum(["local", "openai"]).default("local"),
  // The model that produces the embedding; unset means the provider's default (local: onnx-community/siglip2-base-patch16-224-ONNX, openai: text-embedding-3-small).
  IMAGE_EMBEDDER_MODEL: z.string().optional(),
  // Vision model the openai embedder uses to describe the image before embedding the description.
  IMAGE_DESCRIBE_MODEL: z.string().default("gpt-6-luna"),
  OPENAI_API_KEY: z.string().optional(),
  PRODUCT_MATCH_CANDIDATES: z.coerce.number().int().min(1).max(MAX_CANDIDATES).default(5),
  PRODUCT_MATCH_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  PRODUCT_MATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

/** Indexing embedder and visual step of the cascade from one env selection; both null (visual_search_disabled) without the provider key. */
export function createVisualSearch(env: Env): VisualSearchSetup {
  const config = visualEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  if (!config.OPENAI_API_KEY) {
    log.info({ event: "product_visual_search_disabled", reason: "missing_api_key" }, "product_visual_search_disabled");
    return { embedder: null, visual: null };
  }
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: config.PRODUCT_MATCH_TIMEOUT_MS, maxRetries: 0 });
  let embedder: ImageEmbedder;
  switch (config.IMAGE_EMBEDDER_PROVIDER) {
    case "local": embedder = createLocalImageEmbedder({ modelId: config.IMAGE_EMBEDDER_MODEL ?? DEFAULT_LOCAL_IMAGE_MODEL, currentCompanyId: getCompanyId }); break;
    case "openai": embedder = createOpenAiImageEmbedder({ client, describeModel: config.IMAGE_DESCRIBE_MODEL,
      embedModel: config.IMAGE_EMBEDDER_MODEL ?? "text-embedding-3-small", currentCompanyId: getCompanyId });
  }
  let chooseProduct: VisualSearch["chooseProduct"];
  switch (config.PRODUCT_MATCHER_PROVIDER) {
    case "openai": chooseProduct = createOpenAIProductChooser({ client, model: config.PRODUCT_MATCHER_MODEL, timeoutMs: config.PRODUCT_MATCH_TIMEOUT_MS, companyId: getCompanyId });
  }
  return { embedder, visual: { model: embedder.model, embedImage: embedder.embedImage, brightenDimPhoto, cropPostPhoto, candidates: config.PRODUCT_MATCH_CANDIDATES,
    minConfidence: config.PRODUCT_MATCH_MIN_CONFIDENCE as MatchConfidence, chooseProduct,
    hasIndexedProducts, findNearestProductImages, readImage: (imageId) => readImageBytes(imageId, imageStorage, imageRepository) } };
}

const candidateEnvSchema = z.object({
  TEXT_MATCH_CANDIDATES: z.coerce.number().int().min(1).max(MAX_CANDIDATES).default(defaultTextMatchLimits.candidates),
  TEXT_MATCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(defaultTextMatchLimits.minSimilarity),
  TEXT_MATCH_PAIR_BUDGET: z.coerce.number().int().positive().default(defaultTextMatchLimits.pairBudget),
  TEXT_MATCH_MIN_WORDS: z.coerce.number().int().min(1).default(defaultTextMatchLimits.minWords),
  TEXT_MATCH_MAX_WORDS: z.coerce.number().int().min(1).default(defaultTextMatchLimits.maxWords),
});

/** Message candidate search limits from env; invalid values fail at startup, empty values count as unset. */
export function createMessageCandidateLimits(env: Env) {
  const config = candidateEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  return { candidates: config.TEXT_MATCH_CANDIDATES, minSimilarity: config.TEXT_MATCH_MIN_SIMILARITY, pairBudget: config.TEXT_MATCH_PAIR_BUDGET,
    minWords: config.TEXT_MATCH_MIN_WORDS, maxWords: config.TEXT_MATCH_MAX_WORDS, timeoutMs: 1_000 };
}

const messageCandidateLimits = createMessageCandidateLimits(process.env);

const visualSearchSetup = createVisualSearch(process.env);
export const imageEmbedder = visualSearchSetup.embedder;
const readinessDependencies = { visualModel: visualSearchSetup.visual?.model ?? null, hasActiveProducts, hasIndexedProducts };

const identificationDependencies = {
  readQrCodes,
  findVariantsByCodes: async (codes: readonly VariantQrCode[]) => {
    const found = await findSellableVariantsByQrCodes(codes);
    return found.success ? ok(found.data.map((item) => ({ ...item, qrCode: item.qrCode as VariantQrCode, productId: item.productId as ProductId }))) : found;
  },
  visual: visualSearchSetup.visual,
};

const retryableIndexCodes: readonly PhotoIndexFailure["code"][] = ["PERSISTENCE_UNAVAILABLE", "IMAGE_STORAGE_UNAVAILABLE", "EMBEDDER_UNAVAILABLE"];

/** Handler of `product_photos_added`: logs each photo outcome and retries the job only when some photo failed with a retryable code. */
export const indexProductPhotosHandler: EventHandler<AppEvents, "product_photos_added"> = async (payload, metadata, context) => {
  const started = performance.now();
  const base = { companyId: payload.companyId, productId: payload.productId };
  if (!imageEmbedder) {
    log.debug({ event: "product_photos_index_skipped", ...base, reason: "visual_search_disabled" }, "product_photos_index_skipped");
    return ok(undefined);
  }
  const result = await withTenantIsolation(payload.companyId, () => indexProductPhotos({ productId: payload.productId }, {
    findPhotoIndexState, saveEmbedding, embedImage: imageEmbedder.embedImage, model: imageEmbedder.model,
    readImage: (imageId) => readImageBytes(imageId, imageStorage, imageRepository),
  }));
  if (!result.success) {
    log.error({ event: "product_photos_index_failed", ...base, eventId: metadata.eventId, errorCode: result.error.code, attempt: context.attempt, err: result.error }, "product_photos_index_failed");
    return err({ code: result.error.code, message: result.error.message, retryable: true });
  }
  const outcome = result.data;
  if (outcome.kind === "skipped") {
    log.debug({ event: "product_photos_index_skipped", ...base, reason: outcome.reason }, "product_photos_index_skipped");
    return ok(undefined);
  }
  if (outcome.indexed.length) log.info({ event: "product_photos_indexed", ...base, imageIds: outcome.indexed, indexedCount: outcome.indexed.length,
    failedCount: outcome.failed.length, model: imageEmbedder.model, durationMs: Math.round(performance.now() - started),
    queueLatencyMs: Math.max(0, Date.now() - Date.parse(metadata.occurredAt)) }, "product_photos_indexed");
  for (const failure of outcome.failed) logPhotoFailure(failure, base, metadata.eventId, context.attempt);
  const retryable = outcome.failed.find(({ code }) => retryableIndexCodes.includes(code));
  return retryable ? err({ code: retryable.code, message: retryable.message, retryable: true }) : ok(undefined);
};

/** A retryable failure is a warning until the last attempt. A permanent one is an error on the job's first attempt and debug on later retries, so one bad photo yields one error line per job. */
function logPhotoFailure(failure: PhotoIndexFailure, base: Readonly<{ companyId: string; productId: string }>, eventId: string, attempt: number) {
  const retryable = retryableIndexCodes.includes(failure.code);
  const level = retryable ? (attempt <= indexProductPhotosPolicy.retries ? "warn" : "error") : (attempt === 1 ? "error" : "debug");
  log[level]({ event: "product_photo_index_failed", ...base, imageId: failure.imageId, eventId, errorCode: failure.code, retryable, attempt,
    err: { code: failure.code, message: failure.message } }, "product_photo_index_failed");
}

export const products = {
  /** Runs `work` in one budgeted read snapshot that the assistant reads below join; `operation` names it in `product_search_failed`. */
  readForAssistant: <T, E extends AppError>(work: () => Promise<Result<T, E>>, operation: AssistantReadOperation): Promise<Result<T, E | AssistantReadError>> =>
    assistantSnapshot(operation)(work),
  /** Products by text, variant values, price, stock and catalog membership, 20 per page; joins the open snapshot or opens its own. */
  searchForAssistant: (input: AssistantProductSearch) =>
    searchForAssistant(input, { snapshot: assistantSnapshot("search"), readVocabulary, searchPage }),
  /** One product by identifier or SKU with its variants in saved order; `null` when it does not exist. */
  findForAssistant: (reference: AssistantProductReference) =>
    findForAssistant(reference, { snapshot: assistantSnapshot("detail"), findSkuOwner, readProduct: readProductInSnapshot }),
  identifyProductsInImage: (image: ImageBytes, signal?: AbortSignal) => identifyProductsInImage(image, identificationDependencies, signal),
  /** Active variants and attribute values of these products, for the chat reader. Absent products are deleted ones. */
  findProductsForReading: (productIds: readonly ProductId[]) => findProductsForReading(productIds, { readRows: readProductRowsForReading }),
  /** The products whose name matches the most words of a message; a timeout returns no ids with `timedOut`. */
  findMessageCandidates: (text: string) => findMessageCandidates(text, { searchByCoverage: (words) => searchProductsByCoverage(words, messageCandidateLimits) }),
  catalogSearchReadiness: () => catalogSearchReadiness(readinessDependencies),
  /** Active variants of offered products (active and not hidden) with their stock: the buyer's cart and **Continuar**. */
  findOfferedVariants,
  listForCatalog: (criteria: Parameters<typeof listCatalogProducts>[0]) =>
    listCatalogProducts(criteria, { repository: catalogProductRepository, images: listImages }),
  findVariantPhotos: (variantIds: readonly VariantId[]) => findVariantPhotos(variantIds, { findVariantImages, images: listImages }),
  findForCatalog: (id: Parameters<typeof findCatalogProduct>[0], currency: Parameters<typeof findCatalogProduct>[1]) =>
    findCatalogProduct(id, currency, { repository: catalogProductRepository, images: listImages }),
};
