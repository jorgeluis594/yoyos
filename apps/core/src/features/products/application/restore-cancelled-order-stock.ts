import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, OrderId, OrderCancelled } from "@core/src/features/orders";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { EventHandlerError } from "@core/src/shared/events/application/contracts";
import type { TransactionEndingError } from "@core/src/shared/application/contained-failure";
import type { ProductStockIncreased } from "@core/src/features/products/application/events";

type RestorationError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_ORDER"; message: string }>;
type StockOrder = Readonly<{ cancelled: boolean; stockDeducted: boolean; items: readonly Readonly<{ variantId: VariantId; quantity: number; stockDeductedQuantity: number }>[] }>;
export type RestoreCancelledOrderStockDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RestorationError>>) => Promise<Result<T, RestorationError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<StockOrder | null, RestorationError>>;
  restoreProductStock: (variantId: VariantId, quantity: number) => Promise<Result<null, RestorationError>>;
  /** Runs inside this transaction after the increments; only a transaction-ending failure comes back, everything else is contained and reported in the outcome. */
  publishStockIncreased: (event: ProductStockIncreased) => Promise<Result<unknown, TransactionEndingError>>;
  saveStockRestoration: (id: OrderId, companyId: CompanyId) => Promise<Result<null, RestorationError>>;
}>;
export async function restoreCancelledOrderStock(payload: OrderCancelled, deps: RestoreCancelledOrderStockDependencies): Promise<Result<void, EventHandlerError>> {
  const result = await deps.transaction(payload.companyId, async () => {
    const found = await deps.findOrderForUpdate(payload.orderId, payload.companyId);
    if (!found.success) return found;
    if (!found.data?.cancelled) return err({ code: "INVALID_ORDER", message: "Cancelled order is not available" });
    if (!found.data.stockDeducted) return ok(null);
    const items = [...found.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId));
    // Exactly what was taken out: a line with units still pending (short edit) gives back less than its quantity.
    for (const item of items) {
      if (item.stockDeductedQuantity === 0) continue;
      const restored = await deps.restoreProductStock(item.variantId, item.stockDeductedQuantity);
      if (!restored.success) return restored;
    }
    const [first, ...rest] = items.filter((item) => item.stockDeductedQuantity > 0);
    if (first) {
      const published = await deps.publishStockIncreased({ companyId: payload.companyId, variantIds: [first.variantId, ...rest.map((item) => item.variantId)] });
      if (!published.success) return err({ code: "PERSISTENCE_UNAVAILABLE", message: published.error.message });
    }
    return deps.saveStockRestoration(payload.orderId, payload.companyId);
  });
  return result.success ? ok(undefined) : err({ ...result.error, retryable: result.error.code === "PERSISTENCE_UNAVAILABLE" });
}
