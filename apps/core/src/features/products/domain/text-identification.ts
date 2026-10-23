import type { Money } from "@shared/money";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";

/** Identity of a product named in a message; prices and stock stay out of it. */
export type ProductRef = Readonly<{ productId: ProductId; name: string }>;

export type TextQuery = Readonly<{ mention: string }>;
export type TextCandidate = Readonly<{ productId: ProductId; name: string; minPrice: Money; maxPrice: Money; similarity: number }>;

/** The model's answer over the candidates plus `none`; `productId` null means none. Probabilities cover the candidates only. */
export type TextChoice = Readonly<{
  productId: ProductId | null;
  confidence: number;
  probabilities: readonly Readonly<{ productId: ProductId; probability: number }>[];
}>;

export type TextIdentification =
  | Readonly<{ kind: "found"; productId: ProductId; confidence: number }>
  | Readonly<{ kind: "not_clear"; candidates: readonly [ProductRef, ProductRef, ...ProductRef[]] }>
  | Readonly<{ kind: "not_found" }>;

export type ProductWithSellableVariants = Readonly<{ productId: ProductId; name: string; variants: readonly CatalogItem[] }>;

export type VariantChoiceInput = Readonly<{ words: readonly string[]; variants: readonly CatalogItem[] }>;
/** `variantId` null means none of the offered variants. */
export type VariantChoice = Readonly<{ variantId: VariantId | null; confidence: number }>;

export type VariantResolution =
  | Readonly<{ kind: "resolved"; item: CatalogItem }>
  | Readonly<{ kind: "missing"; attributeNames: readonly string[] }>
  | Readonly<{ kind: "not_available" }>;

export type CatalogSearchReadiness = "no_active_products" | "no_searchable_photos" | "ready";

export type ProductMatcherError = Readonly<{ code: "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE"; message: string }>;

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Variants whose every attribute value appears as whole words in the customer's words, ignoring case and accents. */
export function variantsNamedBy(variants: readonly CatalogItem[], words: readonly string[]): readonly CatalogItem[] {
  const spoken = ` ${words.map(normalize).join(" ")} `;
  return variants.filter(({ variantAttributes }) => {
    const values = Object.values(variantAttributes).map(normalize);
    return values.length > 0 && values.every((value) => value !== "" && spoken.includes(` ${value} `));
  });
}

export const attributeNamesOf = (variants: readonly CatalogItem[]): readonly string[] =>
  [...new Set(variants.flatMap(({ variantAttributes }) => Object.keys(variantAttributes)))];

export const hasWords = (words: readonly string[]) => words.some((word) => normalize(word) !== "");
