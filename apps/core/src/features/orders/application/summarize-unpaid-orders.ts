import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId } from "@core/src/features/orders/domain/order";

/** Over every unpaid order (the same predicate as the `unpaid` view). Balance = total − confirmed payments; reported payments do not reduce it. */
export type UnpaidSummary = Readonly<{ count: number; withPendingReport: number; owed: readonly Money[] }>;
type SummaryError = Readonly<{ code: "INVALID_ORDER" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

export function summarizeUnpaidOrders(_input: Record<string, never>, context: OrderAccess,
  summarizeUnpaid: (companyId: CompanyId) => Promise<Result<UnpaidSummary, SummaryError>>) {
  return summarizeUnpaid(context.companyId);
}
