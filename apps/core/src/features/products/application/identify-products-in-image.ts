import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageReadError } from "@core/src/shared/images";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { ReadQrCodes } from "@core/src/features/products/infrastructure/qr-code-reader";
import {
  acceptVisualMatch, selectProductCode, selectVisualVariant,
  type CatalogItem, type EmbeddingModel, type EmbeddingVector, type ImageBytes, type MatchConfidence, type VariantQrCode, type VisualCandidate, type VisualChoice,
} from "@core/src/features/products/domain/image-identification";

export type ImageIdentification =
  | Readonly<{ kind: "found"; method: "qr"; items: readonly CatalogItem[]; unknownCodes: readonly VariantQrCode[] }>
  | Readonly<{ kind: "found"; method: "visual"; items: readonly [CatalogItem]; confidence: MatchConfidence; candidates: number }>
  | Readonly<{ kind: "not_found"; reason: IdentificationMissReason }>;

export type IdentificationMissReason =
  | "unreadable_image"          // QR step could not decode the image; visual is not attempted
  | "unknown_qr_codes"          // product QR present but no sellable variant (other company, deleted)
  | "visual_search_disabled"
  | "no_indexed_products"
  | "no_visual_match"           // model answered none
  | "low_confidence"
  | "ambiguous_variant";        // product with several sellable variants

export type IdentifyProductsError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "QR_READER_UNAVAILABLE"
    | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING" | "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE";
  message: string;
}>;

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type EmbedImage = (image: ImageBytes) => Promise<Result<EmbeddingVector, Readonly<{ code: "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING"; message: string }>>>;
export type ChooseProduct = (input: Readonly<{ query: ImageBytes; candidates: readonly Readonly<{ productId: ProductId; image: ImageBytes }>[] }>) =>
  Promise<Result<VisualChoice, Readonly<{ code: "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE"; message: string }>>>;

export type VisualSearch = Readonly<{
  model: EmbeddingModel;
  candidates: number;
  minConfidence: MatchConfidence;
  embedImage: EmbedImage;
  findNearestProductImages: (vector: EmbeddingVector, model: EmbeddingModel, limit: number) =>
    Promise<Result<readonly VisualCandidate[], PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  chooseProduct: ChooseProduct;
  findSellableVariantsOfProduct: (productId: ProductId) => Promise<Result<readonly CatalogItem[], PersistenceError>>;
}>;

export type IdentifyProductsDependencies = Readonly<{
  readQrCodes: ReadQrCodes;
  findVariantsByCodes: (codes: readonly VariantQrCode[]) => Promise<Result<readonly (CatalogItem & { qrCode: VariantQrCode })[], PersistenceError>>;
  visual: VisualSearch | null; // null = not configured
}>;

type Identified = Result<ImageIdentification, IdentifyProductsError>;
const notFound = (reason: IdentificationMissReason): Identified => ok({ kind: "not_found", reason });

/** Cascade: printed QR first; visual search only when the image carries no product QR. */
export async function identifyProductsInImage(image: ImageBytes, deps: IdentifyProductsDependencies): Promise<Identified> {
  const decoded = await deps.readQrCodes(image);
  // Una imagen ilegible se omite: reintentar no cambia el resultado.
  if (!decoded.success) return decoded.error.code === "QR_READER_UNAVAILABLE" ? err({ code: decoded.error.code, message: decoded.error.message }) : notFound("unreadable_image");
  const selection = selectProductCode(decoded.data);
  if (selection.kind === "skip") return deps.visual ? searchVisually(image, deps.visual) : notFound("visual_search_disabled");
  const variants = await deps.findVariantsByCodes(selection.codes);
  if (!variants.success) return variants;
  if (!variants.data.length) return notFound("unknown_qr_codes");
  const known = new Set<string>(variants.data.map((variant) => variant.qrCode));
  return ok({ kind: "found", method: "qr", items: variants.data, unknownCodes: selection.codes.filter((code) => !known.has(code)) });
}

async function searchVisually(image: ImageBytes, visual: VisualSearch): Promise<Identified> {
  const vector = await visual.embedImage(image);
  if (!vector.success) return vector;
  const nearest = await visual.findNearestProductImages(vector.data, visual.model, visual.candidates);
  if (!nearest.success) return nearest;
  const read = await Promise.all(nearest.data.map(async (candidate) => ({ candidate, image: await visual.readImage(candidate.imageId) })));
  const failed = read.find(({ image }) => !image.success && image.error.code !== "IMAGE_NOT_FOUND");
  if (failed && !failed.image.success) return err({ code: failed.image.error.code as "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE", message: failed.image.error.message });
  // An image deleted after indexing only drops that candidate.
  const available = read.flatMap(({ candidate, image }) => image.success ? [{ candidate, image: image.data }] : []);
  if (!available.length) return notFound("no_indexed_products");
  const choice = await visual.chooseProduct({ query: image, candidates: available.map(({ candidate, image }) => ({ productId: candidate.productId, image })) });
  if (!choice.success) return choice;
  const match = acceptVisualMatch(choice.data, available.map(({ candidate }) => candidate), visual.minConfidence);
  if (match.kind === "rejected") return notFound(match.reason);
  const variants = await visual.findSellableVariantsOfProduct(match.productId);
  if (!variants.success) return variants;
  const selected = selectVisualVariant(variants.data);
  return selected.kind === "rejected" ? notFound(selected.reason)
    : ok({ kind: "found", method: "visual", items: [selected.item], confidence: match.confidence, candidates: available.length });
}
