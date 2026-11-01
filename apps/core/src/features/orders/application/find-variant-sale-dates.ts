import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { SalesReadFailure, SalesWindow } from "@core/src/features/orders/application/sales-types";

/** Exact, in any date and any currency; both dates are null for a variant sold in the window, and `firstAfter` is null unless it was asked for. */
export type VariantSaleDates = Readonly<{ variantId: string; soldInWindow: boolean; lastBefore: Date | null; firstAfter: Date | null }>;
/** `needFirstAfter`: the period ended before today, so a later sale can exist. */
export type FindVariantSaleDatesInput = Readonly<{ window: SalesWindow; variantIds: readonly string[]; needFirstAfter: boolean }>;
export type FindVariantSaleDatesDependencies = Readonly<{
  readSaleDates: (input: FindVariantSaleDatesInput, companyId: CompanyId) => Promise<Result<readonly VariantSaleDates[], SalesReadFailure>>;
}>;

/**
 * For each variant: whether it sold in the window, its latest sale before it and, when asked, its earliest sale after it. A cancelled order or an
 * unconfirmed catalog order is never a sale. Nothing is read for an empty list.
 */
export async function findVariantSaleDates(input: FindVariantSaleDatesInput, access: OrderAccess, deps: FindVariantSaleDatesDependencies): Promise<Result<readonly VariantSaleDates[], SalesReadFailure>> {
  if (input.variantIds.length === 0) return { success: true, data: [] };
  return deps.readSaleDates(input, access.companyId);
}
