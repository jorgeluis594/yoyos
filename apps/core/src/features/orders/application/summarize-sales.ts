import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { SalesReadFailure, SalesWindow } from "@core/src/features/orders/application/sales-types";
import type { PaymentMethod, WalletProvider } from "@core/src/features/orders/domain/payment";
import type { CompanyId } from "@core/src/features/orders/domain/order";

export type SummarizeSalesInput = Readonly<{ current: SalesWindow; previous: SalesWindow }>;
export type ReceivedBy = Readonly<{ method: PaymentMethod; walletProvider: WalletProvider | null; amount: Money }>;
export type SalesFigures = Readonly<{
  currency: Currency;
  orders: number; items: Money; deliveryCharges: Money; total: Money;
  received: Money; owed: Money; overpaid: Money;           // total = received + owed − overpaid, per order then summed
  receivedBy: readonly ReceivedBy[];
  cancelled: Readonly<{ orders: number; total: Money; confirmed: Money }>;
}>;
export type SalesSummary = Readonly<{
  current: readonly SalesFigures[]; previous: readonly SalesFigures[];      // `items` is `Order.itemsTotal` summed; one entry per currency with orders (sales or cancelled) in that window
  pendingReports: Readonly<{ reports: number; orders: number }>;           // current window, not cancelled
  storeHasOrders: boolean;                                                  // an order visible to the seller exists, in any date
}>;
export type SummarizeSalesDependencies = Readonly<{
  readFigures: (input: SummarizeSalesInput, companyId: CompanyId) => Promise<Result<SalesSummary, SalesReadFailure>>;
}>;

/** The sales figures of a period and of the one before it, in one read: nothing is added across currencies and nothing is partial on failure. */
export async function summarizeSales(input: SummarizeSalesInput, access: OrderAccess, deps: SummarizeSalesDependencies): Promise<Result<SalesSummary, SalesReadFailure>> {
  return deps.readFigures(input, access.companyId);
}
