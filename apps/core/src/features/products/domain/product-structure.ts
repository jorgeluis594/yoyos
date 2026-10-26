import type { OptionId, OptionValueId, Product, ProductVariant } from "@core/src/features/products/domain/product";

type Combination = Readonly<Record<OptionId, OptionValueId>>;

/** Value ids as lowercase text, sorted by code unit (the "C" collation in SQL) and joined by ",". Empty without options. */
export function combinationKey(combination: Combination): string {
  return Object.values(combination).map((valueId) => valueId.toLowerCase()).sort().join(",");
}

function valuePositions(product: Product): ReadonlyMap<OptionValueId, number> {
  return new Map(product.options.flatMap((option) => option.values.map((value, position) => [value.id, position] as const)));
}

/** Variants by option positions and then value positions, so combinations read as the seller ordered them. */
export function sortVariants(product: Product): Product["variants"] {
  const positions = valuePositions(product);
  const rank = (variant: ProductVariant) => product.options.map((option) => positions.get(variant.combination[option.id] as OptionValueId) ?? Number.MAX_SAFE_INTEGER);
  const sorted = [...product.variants].sort((left, right) => {
    const leftRank = rank(left);
    const rightRank = rank(right);
    for (let index = 0; index < leftRank.length; index += 1) if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index];
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return sorted as unknown as Product["variants"];
}

/** Option name to value name, with keys inserted in saved option order. */
export function orderedAttributes(product: Product, variant: ProductVariant): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  for (const option of product.options) {
    const value = option.values.find((candidate) => candidate.id === variant.combination[option.id]);
    if (value) attributes[option.name] = value.name;
  }
  return attributes;
}
