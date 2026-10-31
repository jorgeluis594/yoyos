import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Currency, Money } from "@shared/money";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { lowStockThreshold, type StockLevel, type VariantStockFilter } from "@core/src/features/products/domain/stock-level";
import { buildVocabulary, parseSearchCriteria, resolveValues, type PriceCents, type SearchCriteriaError, type SearchInput, type Spelling, type ValueRejection, type VocabularyRow } from "@core/src/features/products/domain/product-search";
import type { AssistantReadError, AssistantSnapshot } from "@core/src/features/products/application/assistant-read";

export type SkuSummary = Readonly<{ kind: "single"; sku: string | null }> | Readonly<{ kind: "several" }>;
export type ActiveSummary =
  | Readonly<{ kind: "none"; sku: SkuSummary }>                       // over all variants
  | Readonly<{ kind: "some"; count: number; minSalePrice: Money; hasDifferentPrices: boolean; totalStock: number; soldOut: number; low: number;
      onlyLevel: StockLevel | null; sku: SkuSummary }>;               // onlyLevel: the level when there is exactly one active variant
export type SearchedVariant = Readonly<{ id: VariantId; values: readonly string[]; sku: string | null; salePrice: Money; stock: number; level: StockLevel }>;
export type SearchedProduct = Readonly<{
  id: ProductId; name: string; currency: Currency; variantCount: number; inactiveCount: number; active: ActiveSummary;
  matching: Readonly<{ variants: readonly SearchedVariant[]; total: number }> | null;  // null without variant filters; at most 10 variants
}>;
export type ProductSearchPage = Readonly<{ items: readonly SearchedProduct[]; page: number; total: number; storeHasProducts: boolean }>;
export type ProductSearchQuery = Readonly<{
  text?: string; valueSets: readonly (readonly Spelling[])[]; priceFrom?: PriceCents; priceTo?: PriceCents; stock?: VariantStockFilter;
  inCatalog?: boolean; sort: "recent" | "name"; offset: number; limit: number; lowStockThreshold: number; matchingVariantCap: number;
}>;

/** The plain input is the domain's `SearchInput`, re-exported under the use case's name. */
export type AssistantProductSearch = SearchInput;
export type SearchForAssistantDependencies = Readonly<{
  snapshot: AssistantSnapshot;
  readVocabulary: () => Promise<Result<readonly VocabularyRow[], AssistantReadError>>;
  searchPage: (query: ProductSearchQuery) => Promise<Result<ProductSearchPage, AssistantReadError>>;
}>;
export type SearchForAssistantError =
  | Readonly<{ code: "PRICE_RANGE_REVERSED" | "VARIANT_FILTER_OUTSIDE_CATALOG" | "INVALID_PRICE"; message: string }>
  | Readonly<{ code: "VALUE_REJECTED"; rejection: ValueRejection; message: string }>
  | AssistantReadError;

export const pageSize = 20;
export const matchingVariantCap = 10;

/** Pages the store's products by text, variant values, price, stock and catalog membership; the filters on variants all apply to the same active variant. */
export async function searchForAssistant(input: AssistantProductSearch, deps: SearchForAssistantDependencies): Promise<Result<ProductSearchPage, SearchForAssistantError>> {
  const criteria = parseSearchCriteria(input);
  if (!criteria.success) return criteria as Result<never, SearchCriteriaError>;
  const { values, text, priceFrom, priceTo, stock, inCatalog, sort, page } = criteria.data;
  return deps.snapshot<ProductSearchPage, SearchForAssistantError>(async () => {
    let valueSets: readonly (readonly Spelling[])[] = [];
    if (values) {
      const rows = await deps.readVocabulary();
      if (!rows.success) return rows;
      const resolved = resolveValues(values, buildVocabulary(rows.data));
      if (!resolved.success) {
        const { message, ...rejection } = resolved.error;
        return err({ code: "VALUE_REJECTED", rejection, message });
      }
      valueSets = resolved.data;
    }
    const found = await deps.searchPage({
      ...text === undefined ? {} : { text }, valueSets,
      ...priceFrom === undefined ? {} : { priceFrom }, ...priceTo === undefined ? {} : { priceTo },
      ...stock === undefined ? {} : { stock }, ...inCatalog === undefined ? {} : { inCatalog },
      sort, offset: (page - 1) * pageSize, limit: pageSize, lowStockThreshold, matchingVariantCap,
    });
    return found.success ? ok(found.data) : found;
  });
}
