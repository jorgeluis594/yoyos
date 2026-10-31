import { ok } from "@shared/functional";
import { productNameKey } from "@core/src/features/products/domain/product-name-key";
import type { Result } from "@shared/result";
import type { Money } from "@shared/money";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;

/** What one read snapshot returns for a set of products; the rows are validated by the reader. */
export type ReadingRows = Readonly<{
  products: readonly Readonly<{ id: ProductId; name: string; status: string }>[];
  /** Active variants of those products. */
  variants: readonly Readonly<{ id: VariantId; productId: ProductId; sku: string | null; unitPrice: Money }>[];
  /** One row per variant option, with the stored positions of the option and of its value. */
  options: readonly Readonly<{ variantId: VariantId; optionName: string; optionPosition: number; valueName: string; valuePosition: number }>[];
}>;

export type FindProductsForReadingDependencies = Readonly<{
  readRows: (productIds: readonly ProductId[]) => Promise<Result<ReadingRows, PersistenceError | InvalidStoredData>>;
}>;

type VariantOption = ReadingRows["options"][number];

const byPosition = (left: VariantOption, right: VariantOption) => left.optionPosition - right.optionPosition;

function compareVariants(left: readonly VariantOption[], right: readonly VariantOption[], leftId: string, rightId: string): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index]!.valuePosition - right[index]!.valuePosition;
    if (difference !== 0) return difference;
  }
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

/** The products as the reader sees them, in the order asked. A product the rows do not hold is absent. */
export function buildProductsForReading(productIds: readonly ProductId[], rows: ReadingRows): readonly ProductForReading[] {
  const optionsOf = new Map<VariantId, VariantOption[]>();
  for (const option of rows.options) optionsOf.set(option.variantId, [...optionsOf.get(option.variantId) ?? [], option]);
  for (const options of optionsOf.values()) options.sort(byPosition);
  const productsById = new Map(rows.products.map((product) => [product.id, product]));
  return [...new Set(productIds)].flatMap((productId) => {
    const product = productsById.get(productId);
    if (!product) return [];
    const active = product.status === "active";
    const variants = active ? rows.variants.filter((variant) => variant.productId === productId)
      .map((variant) => ({ variant, options: optionsOf.get(variant.id) ?? [] }))
      .sort((left, right) => compareVariants(left.options, right.options, left.variant.id, right.variant.id)) : [];
    const attributes = new Map<string, { position: number; values: Map<string, number> }>();
    for (const { options } of variants) for (const option of options) {
      const attribute = attributes.get(option.optionName) ?? { position: option.optionPosition, values: new Map<string, number>() };
      attribute.values.set(option.valueName, option.valuePosition);
      attributes.set(option.optionName, attribute);
    }
    const items: CatalogItem[] = variants.map(({ variant, options }) => ({
      variantId: variant.id, productName: product.name, sku: variant.sku, unitPrice: variant.unitPrice,
      variantAttributes: Object.fromEntries(options.map((option) => [option.optionName, option.valueName])),
    }));
    return [{
      productId, name: product.name, nameKey: productNameKey(product.name), sellable: items.length > 0,
      attributes: [...attributes].sort(([, left], [, right]) => left.position - right.position)
        .map(([name, { values }]) => ({ name, values: [...values].sort(([, left], [, right]) => left - right).map(([value]) => value) })),
      variants: items,
    }];
  });
}

/** Products with every active variant and attribute value, from one read snapshot. */
export async function findProductsForReading(productIds: readonly ProductId[], deps: FindProductsForReadingDependencies): Promise<Result<readonly ProductForReading[], PersistenceError | InvalidStoredData>> {
  if (!productIds.length) return ok([]);
  const rows = await deps.readRows(productIds);
  return rows.success ? ok(buildProductsForReading(productIds, rows.data)) : rows;
}
