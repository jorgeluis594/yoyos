import type { Result } from "@shared/result";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductReadError } from "@core/src/features/products/application/repository";

/** A variant with the current name of its product and its values in option order (empty for a product without options). */
export type DescribedVariant = Readonly<{ variantId: string; productId: ProductId; productName: string; values: readonly string[]; matchesText: boolean }>;
export type DescribeVariantsInput =
  | Readonly<{ by: "variants"; variantIds: readonly string[]; text?: string }>      // text trimmed, 1..120
  | Readonly<{ by: "product"; productId: ProductId }>;
export type DescribeVariantsDependencies = Readonly<{
  readVariants: (input: DescribeVariantsInput) => Promise<Result<readonly DescribedVariant[], ProductReadError>>;
}>;

/**
 * Names and combinations for the assistant's sales reads, in one statement that joins the snapshot of the call. `by: "variants"` describes the given ids
 * (another store's id is absent, a deactivated variant is described); `by: "product"` is the light read of one product with all its variants, and
 * answers nothing for an unknown or foreign product.
 */
export async function describeVariantsForAssistant(input: DescribeVariantsInput, deps: DescribeVariantsDependencies): Promise<Result<readonly DescribedVariant[], ProductReadError>> {
  if (input.by === "variants" && input.variantIds.length === 0) return { success: true, data: [] };
  const text = input.by === "variants" ? input.text?.trim() : undefined;
  return deps.readVariants(input.by === "variants" ? { by: "variants", variantIds: input.variantIds, ...text ? { text } : {} } : input);
}
