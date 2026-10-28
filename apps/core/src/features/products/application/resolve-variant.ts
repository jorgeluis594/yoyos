import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { VariantId } from "@core/src/features/products/domain/product";
import { attributeNamesOf, hasWords, type ProductMatcherError, type ProductWithSellableVariants, type VariantChoice, type VariantChoiceInput, type VariantResolution }
  from "@core/src/features/products/domain/text-identification";

export type ResolveVariantDependencies = Readonly<{
  chooseVariant: (input: VariantChoiceInput, signal: AbortSignal) => Promise<Result<VariantChoice, ProductMatcherError>>;
  minConfidence: number;
}>;

/**
 * The single authority on which variant of a product a customer means, for photos and texts alike. Without words the base variant or
 * the only sellable one is kept; with words the variant chooser decides, and only a sellable variant it chose at `minConfidence` is used.
 */
export async function resolveVariant(
  input: Readonly<{ product: ProductWithSellableVariants; words: readonly string[]; preselectedVariantId: VariantId | null }>,
  deps: ResolveVariantDependencies,
  signal: AbortSignal,
): Promise<Result<VariantResolution, ProductMatcherError>> {
  const { variants } = input.product;
  const [only] = variants;
  if (!only) return ok({ kind: "not_available" });
  if (!hasWords(input.words)) {
    const preselected = variants.find(({ variantId }) => variantId === input.preselectedVariantId);
    if (preselected) return ok({ kind: "resolved", item: preselected });
    return variants.length === 1 ? ok({ kind: "resolved", item: only }) : ok({ kind: "missing", attributeNames: attributeNamesOf(variants) });
  }
  // Understanding the words is the chooser's job: it gets the sellable variants and the base as data and answers one of them or none.
  const base = variants.find(({ variantId }) => variantId === input.preselectedVariantId) ?? null;
  const choice = await deps.chooseVariant({ words: input.words, variants, base }, signal);
  if (!choice.success) return choice;
  const chosen = variants.find(({ variantId }) => variantId === choice.data.variantId);
  return ok(chosen && choice.data.confidence >= deps.minConfidence ? { kind: "resolved", item: chosen } : { kind: "not_available" });
}
