import { normalizeValue, type AttributeChoice, type KnownValues } from "@core/src/features/orders/domain/pending-transitions";
import type { ExtractedValue } from "@core/src/features/orders/domain/reader/readings";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

export const maxQuestionValues = 3;

/** A list of values short enough for a question; longer lists are left out and the question asks without them. */
export const questionValues = (values: readonly string[]): readonly string[] => (values.length <= maxQuestionValues ? values : []);

/** The values every sellable variant matching `known` still offers for each attribute that varies. */
export function openAttributes(product: ProductForReading, known: KnownValues): readonly Readonly<{ name: string; values: readonly string[] }>[] {
  const matching = product.variants.filter((variant) => Object.entries(known).every(([name, value]) => variant.variantAttributes[name] === value));
  return product.attributes.flatMap((attribute) => {
    if (known[attribute.name] !== undefined) return [];
    const values = attribute.values.filter((value) => matching.some((variant) => variant.variantAttributes[attribute.name] === value));
    return values.length > 1 ? [{ name: attribute.name, values }] : [];
  });
}

/** Maps the buyer's value words to catalog attributes by their values only, comparing characters (case and accents) and never meaning. Unmatched words keep their own text so the catalog check rejects them. */
export function choicesFromWords(product: ProductForReading, values: readonly ExtractedValue[]): readonly AttributeChoice[] {
  return values.map((entry) => {
    const word = normalizeValue(entry.valueWords.text.trim());
    const named = entry.attributeWords ? normalizeValue(entry.attributeWords.text.trim()) : null;
    const byName = named ? product.attributes.find((attribute) => normalizeValue(attribute.name) === named) : undefined;
    const attribute = [byName, ...product.attributes].find((candidate) => candidate?.values.some((value) => normalizeValue(value) === word));
    return { name: attribute?.name ?? byName?.name ?? entry.attributeWords?.text ?? "", value: attribute?.values.find((value) => normalizeValue(value) === word) ?? entry.valueWords.text };
  });
}
