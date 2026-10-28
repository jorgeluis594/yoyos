import { z } from "zod";
import type { Money } from "@shared/money";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

export type ImageBytes = Readonly<{ bytes: Uint8Array; contentType: string }>;
export type EmbeddingModel = string & { readonly __brand: "EmbeddingModel" };
export type EmbeddingVector = readonly number[] & { readonly __brand: "EmbeddingVector" };
export type ImageEmbedding = Readonly<{ imageId: ImageId; model: EmbeddingModel; vector: EmbeddingVector }>;

export function parseEmbeddingModel(value: string): EmbeddingModel | null {
  return value.length > 0 && value.length <= 100 ? value as EmbeddingModel : null;
}

export function parseEmbeddingVector(values: readonly number[], dimensions: number): EmbeddingVector | null {
  return values.length === dimensions && values.every(Number.isFinite) ? values as EmbeddingVector : null;
}

export type VariantQrCode = string & { readonly __brand: "VariantQrCode" };

export type ScanSelection =
  | Readonly<{ kind: "codes"; codes: readonly [VariantQrCode, ...VariantQrCode[]] }>
  | Readonly<{ kind: "skip"; reason: "no_qr_code" | "unrecognized_qr_code" }>;

const productCodeSchema = z.uuid(); // QR de pago (Yape/Plin) o URLs no son productos

export function selectProductCode(decoded: readonly string[]): ScanSelection {
  if (!decoded.length) return { kind: "skip", reason: "no_qr_code" };
  const codes = [...new Set(decoded.filter((value) => productCodeSchema.safeParse(value).success))];
  const [first, ...rest] = codes as VariantQrCode[];
  return first ? { kind: "codes", codes: [first, ...rest] } : { kind: "skip", reason: "unrecognized_qr_code" };
}

export type CatalogItem = Readonly<{ variantId: VariantId; productName: string; variantAttributes: Readonly<Record<string, string>>; sku: string | null; unitPrice: Money }>;
export type MatchConfidence = number & { readonly __brand: "MatchConfidence" };
/** The product's closest photo to the customer image and its position among the product's photos. */
export type VisualCandidate = Readonly<{ productId: ProductId; imageId: ImageId; position: number; distance: number }>;
/** `showsProduct` is the probability that the first image shows a product offered for sale (not a payment screenshot, selfie, map or document). */
export type VisualChoice =
  | Readonly<{ kind: "product"; productId: ProductId; confidence: MatchConfidence; showsProduct: number }>
  | Readonly<{ kind: "none"; confidence: MatchConfidence; showsProduct: number }>;

export const minShowsProduct = 0.5;

export const showsProduct = (choice: VisualChoice) => choice.showsProduct >= minShowsProduct;

export function parseMatchConfidence(value: number): MatchConfidence | null {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value as MatchConfidence : null;
}

// Rejects a choice outside the candidates (the adapter already maps labels; this is the invariant).
export function acceptVisualMatch(choice: VisualChoice, candidates: readonly VisualCandidate[], minConfidence: MatchConfidence):
  Readonly<{ kind: "accepted"; productId: ProductId; confidence: MatchConfidence }> | Readonly<{ kind: "rejected"; reason: "no_visual_match" | "low_confidence" }> {
  if (choice.kind === "none" || !candidates.some(({ productId }) => productId === choice.productId)) return { kind: "rejected", reason: "no_visual_match" };
  if (choice.confidence < minConfidence) return { kind: "rejected", reason: "low_confidence" };
  return { kind: "accepted", productId: choice.productId, confidence: choice.confidence };
}
