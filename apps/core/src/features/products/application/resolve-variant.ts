import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { VariantId } from "@core/src/features/products/domain/product";
import { attributeNamesOf, hasWords, variantByNamedValues, type ProductMatcherError, type ProductWithSellableVariants, type VariantChoice, type VariantChoiceInput, type VariantResolution }
  from "@core/src/features/products/domain/text-identification";

export type ResolveVariantDependencies = Readonly<{
  chooseVariant: (input: VariantChoiceInput, signal: AbortSignal) => Promise<Result<VariantChoice, ProductMatcherError>>;
  minConfidence: number;
}>;

/** The single authority on which variant of a product a customer means, for photos and texts alike. */
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
  // The words win over the base variant (QR-selected or being changed) only for the attributes they name; it keeps the rest.
  const base = variants.find(({ variantId }) => variantId === input.preselectedVariantId) ?? null;
  const named = variantByNamedValues(variants, input.words, base);
  if (named.kind === "named") return ok({ kind: "resolved", item: named.item });
  if (named.kind === "not_sellable") return ok({ kind: "not_available" });
  const choice = await deps.chooseVariant({ words: input.words, variants }, signal);
  if (!choice.success) return choice;
  const chosen = variants.find(({ variantId }) => variantId === choice.data.variantId);
  return ok(chosen && choice.data.confidence >= deps.minConfidence ? { kind: "resolved", item: chosen } : { kind: "not_available" });
}
