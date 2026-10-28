import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageReadError } from "@core/src/shared/images";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { ReadQrCodes } from "@core/src/shared/images/infrastructure/qr-code-reader";
import type { EmbedImage } from "@core/src/features/products/application/index-product-image";
import {
  acceptVisualMatch, selectProductCode, showsProduct,
  type CatalogItem, type EmbeddingModel, type EmbeddingVector, type ImageBytes, type MatchConfidence, type VariantQrCode, type VisualCandidate, type VisualChoice,
} from "@core/src/features/products/domain/image-identification";

/** A sellable variant read from its QR code, with the product it belongs to. */
export type IdentifiedItem = CatalogItem & Readonly<{ productId: ProductId }>;

// A visual hit names only the product: the variant is chosen later by the single variant authority (`resolveVariant`).
export type ImageIdentification =
  | Readonly<{ kind: "found"; method: "qr"; items: readonly IdentifiedItem[]; unknownCodes: readonly VariantQrCode[] }>
  | Readonly<{ kind: "found"; method: "visual"; productId: ProductId; confidence: MatchConfidence; candidates: number } & VisualDistances>
  | Readonly<{ kind: "not_found"; reason: IdentificationMissReason } & Partial<VisualDistances>>
  // Non-product QR codes only, or a photo that does not show a product: no purchase intent.
  | Readonly<{ kind: "not_product" } & Partial<VisualDistances>>;

// Cosine distances only for logs: measure hits vs non-product images before choosing a threshold.
export type VisualDistances = Readonly<{ topDistance: number; chosenDistance?: number }>;

export type IdentificationMissReason =
  | "unreadable_image"          // QR step could not decode the image; visual is not attempted
  | "unknown_qr_codes"          // product QR present but no sellable variant (other company, deleted)
  | "visual_search_disabled"
  | "no_indexed_products"
  | "no_visual_match"           // model answered none
  | "low_confidence";

export type IdentifyProductsError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "QR_READER_UNAVAILABLE"
    | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING" | "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE";
  message: string;
}>;

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** `detail` is a second view of `query`: the photo cut out of a post or chat screenshot, or the brightened copy of a dim photo. */
export type ChooserDetail = Readonly<{ kind: "post_photo" | "brightened"; image: ImageBytes }>;
export type ChooseProduct = (input: Readonly<{ query: ImageBytes; detail?: ChooserDetail; candidates: readonly Readonly<{ productId: ProductId; image: ImageBytes }>[] }>) =>
  Promise<Result<VisualChoice, Readonly<{ code: "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE"; message: string }>>>;

export type VisualSearch = Readonly<{
  model: EmbeddingModel;
  candidates: number;
  minConfidence: MatchConfidence;
  embedImage: EmbedImage;
  /** A dark or washed-out photo with its contrast stretched, or null for a clear one. */
  brightenDimPhoto: (image: ImageBytes) => Promise<ImageBytes | null>;
  /** The photo inside a post or chat screenshot, or null for any other image. */
  cropPostPhoto: (image: ImageBytes) => Promise<ImageBytes | null>;
  hasIndexedProducts: (model: EmbeddingModel) => Promise<Result<boolean, PersistenceError>>;
  findNearestProductImages: (vector: EmbeddingVector, model: EmbeddingModel, limit: number) =>
    Promise<Result<readonly VisualCandidate[], PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  chooseProduct: ChooseProduct;
}>;

export type IdentifyProductsDependencies = Readonly<{
  readQrCodes: ReadQrCodes;
  findVariantsByCodes: (codes: readonly VariantQrCode[]) => Promise<Result<readonly (IdentifiedItem & { qrCode: VariantQrCode })[], PersistenceError>>;
  visual: VisualSearch | null; // null = not configured
}>;

type Identified = Result<ImageIdentification, IdentifyProductsError>;
const notFound = (reason: IdentificationMissReason, distances?: VisualDistances): Identified => ok({ kind: "not_found", reason, ...distances });

/** Cascade: printed QR first; visual search only when the image carries no QR code at all. */
export async function identifyProductsInImage(image: ImageBytes, deps: IdentifyProductsDependencies): Promise<Identified> {
  const decoded = await deps.readQrCodes(image);
  // Una imagen ilegible se omite: reintentar no cambia el resultado.
  if (!decoded.success) return decoded.error.code === "QR_READER_UNAVAILABLE" ? err({ code: decoded.error.code, message: decoded.error.message }) : notFound("unreadable_image");
  const selection = selectProductCode(decoded.data);
  if (selection.kind === "skip" && selection.reason === "unrecognized_qr_code") return ok({ kind: "not_product" }); // Yape/Plin, URLs; visual is not attempted
  if (selection.kind === "skip") return deps.visual ? searchVisually(image, deps.visual) : notFound("visual_search_disabled");
  const variants = await deps.findVariantsByCodes(selection.codes);
  if (!variants.success) return variants;
  if (!variants.data.length) return notFound("unknown_qr_codes");
  const known = new Set<string>(variants.data.map((variant) => variant.qrCode));
  return ok({ kind: "found", method: "qr", items: variants.data, unknownCodes: selection.codes.filter((code) => !known.has(code)) });
}

async function searchVisually(image: ImageBytes, visual: VisualSearch): Promise<Identified> {
  // Cheap check first: without indexed products, embedding the customer image is a wasted provider call.
  const indexed = await visual.hasIndexedProducts(visual.model);
  if (!indexed.success) return indexed;
  if (!indexed.data) return notFound("no_indexed_products");
  // A dim photo is searched by its brightened copy; a screenshot by the photo it shows, so the app screen around it does not pull
  // other products closer. The chooser sees that view beside the image as it came.
  const brightened = await visual.brightenDimPhoto(image);
  const postPhoto = await visual.cropPostPhoto(brightened ?? image);
  const detail: ChooserDetail | null = postPhoto ? { kind: "post_photo", image: postPhoto } : brightened ? { kind: "brightened", image: brightened } : null;
  const vector = await visual.embedImage(detail?.image ?? image);
  if (!vector.success) return vector;
  const nearest = await visual.findNearestProductImages(vector.data, visual.model, visual.candidates);
  if (!nearest.success) return nearest;
  const read = await Promise.all(nearest.data.map(async (candidate) => ({ candidate, image: await visual.readImage(candidate.imageId) })));
  const failed = read.find(({ image }) => !image.success && image.error.code !== "IMAGE_NOT_FOUND");
  if (failed && !failed.image.success) return err({ code: failed.image.error.code as "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE", message: failed.image.error.message });
  // An image deleted after indexing only drops that candidate.
  const available = read.flatMap(({ candidate, image }) => image.success ? [{ candidate, image: image.data }] : []);
  if (!available.length) return notFound("no_indexed_products");
  const choice = await visual.chooseProduct({ query: image, ...(detail && { detail }), candidates: available.map(({ candidate, image }) => ({ productId: candidate.productId, image })) });
  if (!choice.success) return choice;
  const match = acceptVisualMatch(choice.data, available.map(({ candidate }) => candidate), visual.minConfidence);
  const chosenId = choice.data.kind === "product" ? choice.data.productId : null;
  const chosen = available.find(({ candidate }) => candidate.productId === chosenId);
  const distances: VisualDistances = { topDistance: Math.min(...available.map(({ candidate }) => candidate.distance)),
    ...(chosen && { chosenDistance: chosen.candidate.distance }) };
  // A photo that is not a product is no purchase intent, whatever the match said: a selfie in a knitted sweater can still resemble one.
  if (!showsProduct(choice.data)) return ok({ kind: "not_product", ...distances });
  if (match.kind === "rejected") return notFound(match.reason, distances);
  return ok({ kind: "found", method: "visual", productId: match.productId, confidence: match.confidence, candidates: available.length, ...distances });
}
