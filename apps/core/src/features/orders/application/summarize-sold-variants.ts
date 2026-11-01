import type { Result } from "@shared/result";
import type { Currency, Money } from "@shared/money";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { SalesReadFailure, SalesWindow } from "@core/src/features/orders/application/sales-types";

export type SoldVariant = Readonly<{ variantId: string; currency: Currency; units: number; amount: Money }>;
export type CurrencySoldTotals = Readonly<{ currency: Currency; orders: number; units: number; amount: Money }>;
export type SoldVariantsSummary = Readonly<{ variants: readonly SoldVariant[]; currencies: readonly CurrencySoldTotals[] }>;
/** `variantIds` narrows `variants`, never `currencies`: the totals of the whole window are the denominator of every share. */
export type SummarizeSoldVariantsInput = Readonly<{ window: SalesWindow; variantIds?: readonly string[] }>;
export type SummarizeSoldVariantsDependencies = Readonly<{
  readSoldVariants: (input: SummarizeSoldVariantsInput, companyId: CompanyId) => Promise<Result<SoldVariantsSummary, SalesReadFailure>>;
}>;

/**
 * Units and item subtotals per variant sold in the window, by currency, over the orders that are not cancelled and not unconfirmed catalog orders,
 * plus the totals of each currency. Delivery charges never count in a product.
 */
export function summarizeSoldVariants(input: SummarizeSoldVariantsInput, access: OrderAccess, deps: SummarizeSoldVariantsDependencies): Promise<Result<SoldVariantsSummary, SalesReadFailure>> {
  return deps.readSoldVariants(input, access.companyId);
}
