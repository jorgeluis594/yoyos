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

export const attributeNamesOf = (variants: readonly CatalogItem[]): readonly string[] =>
  [...new Set(variants.flatMap(({ variantAttributes }) => Object.keys(variantAttributes)))];

export const hasWords = (words: readonly string[]) => words.some((word) => normalize(word) !== "");

export type VariantByNamedValues = Readonly<{ kind: "named"; item: CatalogItem }> | Readonly<{ kind: "not_sellable" }> | Readonly<{ kind: "undecided" }>;

const valuesOf = (variants: readonly CatalogItem[], attribute: string) => [...new Set(variants.map(({ variantAttributes }) => variantAttributes[attribute] ?? ""))];

/**
 * The variant the words point at when they name only some attribute values: the named values override, the other attributes
 * keep the value of `base` (the variant being changed or the one a QR selected) and an attribute with a single sellable value
 * is filled in. `undecided` when the words name nothing or the rest cannot be settled; `not_sellable` when the combination does not exist.
 */
export function variantByNamedValues(variants: readonly CatalogItem[], words: readonly string[], base: CatalogItem | null): VariantByNamedValues {
  const spoken = ` ${words.map(normalize).join(" ")} `;
  const wanted = new Map<string, string>();
  let namedAny = false;
  for (const attribute of attributeNamesOf(variants)) {
    const values = valuesOf(variants, attribute);
    const named = values.filter((value) => normalize(value) !== "" && spoken.includes(` ${normalize(value)} `))
      .sort((a, b) => normalize(b).length - normalize(a).length);
    const [value] = named;
    if (value !== undefined) { wanted.set(attribute, value); namedAny = true; continue; }
    const [single] = values;
    if (values.length === 1 && single !== undefined) wanted.set(attribute, single);
    else if (base?.variantAttributes[attribute] !== undefined) wanted.set(attribute, base.variantAttributes[attribute]!);
  }
  if (!namedAny) return { kind: "undecided" };
  const matches = variants.filter(({ variantAttributes }) => [...wanted].every(([attribute, value]) => (variantAttributes[attribute] ?? "") === value));
  const [match] = matches;
  if (!match) return { kind: "not_sellable" };
  return matches.length === 1 ? { kind: "named", item: match } : { kind: "undecided" };
}
