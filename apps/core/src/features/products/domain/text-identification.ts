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

/** Words that carry no variant meaning in a request to change or choose one («cámbialo a talla L», «mejor que sea L»). */
const fillerWords: ReadonlySet<string> = new Set(["a", "de", "en", "la", "el", "lo", "las", "los", "un", "una", "que", "sea", "mejor", "por", "para", "quiero",
  "cambialo", "cambiala", "cambia", "cambiar", "pasalo", "pasala", "ponlo", "ponla", "talla", "color", "tamano"]);

const valuesOf = (variants: readonly CatalogItem[], attribute: string) => [...new Set(variants.map(({ variantAttributes }) => variantAttributes[attribute] ?? ""))];
const tokensOf = (text: string) => normalize(text).split(" ").filter((token) => token !== "");
const containsWords = (text: string, part: string) => ` ${normalize(text)} `.includes(` ${normalize(part)} `);

/** The values of `attribute` the words name; a value contained as whole words in another named value is part of it, not a second one. */
function namedValuesOf(variants: readonly CatalogItem[], attribute: string, spoken: string): readonly string[] {
  const named = valuesOf(variants, attribute).filter((value) => normalize(value) !== "" && containsWords(spoken, value));
  return named.filter((value) => !named.some((other) => other !== value && containsWords(other, value)));
}

/**
 * The variant the words point at when they name only some attribute values: the named values override, the other attributes
 * keep the value of `base` (the variant being changed or the one a QR selected) and an attribute with a single sellable value
 * is filled in. `undecided` (the model decides) when the words name nothing, name two values of one attribute, hold any word that is
 * neither a named value, an attribute name nor a filler, or leave an attribute open; `not_sellable` when the combination does not exist.
 */
export function variantByNamedValues(variants: readonly CatalogItem[], words: readonly string[], base: CatalogItem | null): VariantByNamedValues {
  const spoken = words.map(normalize).join(" ");
  const attributes = attributeNamesOf(variants).map((attribute) => ({ attribute, values: valuesOf(variants, attribute), named: namedValuesOf(variants, attribute, spoken) }));
  const understood = new Set([...attributes.flatMap(({ named }) => named.flatMap(tokensOf)), ...attributes.flatMap(({ attribute }) => tokensOf(attribute)), ...fillerWords]);
  const anyNamed = attributes.some(({ named }) => named.length > 0);
  if (!anyNamed || attributes.some(({ named }) => named.length > 1) || !tokensOf(spoken).every((token) => understood.has(token))) return { kind: "undecided" };
  const wanted = attributes.flatMap(({ attribute, values, named }) => {
    const value = named[0] ?? (values.length === 1 ? values[0] : base?.variantAttributes[attribute]);
    return value === undefined ? [] : [[attribute, value] as const];
  });
  const matches = variants.filter(({ variantAttributes }) => wanted.every(([attribute, value]) => (variantAttributes[attribute] ?? "") === value));
  const [match] = matches;
  if (!match) return { kind: "not_sellable" };
  return matches.length === 1 ? { kind: "named", item: match } : { kind: "undecided" };
}
