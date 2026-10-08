import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, OrderId, OrderCancelled } from "@core/src/features/orders";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { EventHandlerError } from "@core/src/shared/events/application/contracts";

type RestorationError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_ORDER"; message: string }>;
type StockOrder = Readonly<{ cancelled: boolean; stockDeducted: boolean; items: readonly Readonly<{ variantId: VariantId; quantity: number }>[] }>;
export type RestoreCancelledOrderStockDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RestorationError>>) => Promise<Result<T, RestorationError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<StockOrder | null, RestorationError>>;
  restoreProductStock: (variantId: VariantId, quantity: number) => Promise<Result<null, RestorationError>>;
  saveStockRestoration: (id: OrderId, companyId: CompanyId) => Promise<Result<null, RestorationError>>;
}>;
export async function restoreCancelledOrderStock(payload: OrderCancelled, deps: RestoreCancelledOrderStockDependencies): Promise<Result<void, EventHandlerError>> {
  const result = await deps.transaction(payload.companyId, async () => {
    const found = await deps.findOrderForUpdate(payload.orderId, payload.companyId);
    if (!found.success) return found;
    if (!found.data?.cancelled) return err({ code: "INVALID_ORDER", message: "Cancelled order is not available" });
    if (!found.data.stockDeducted) return ok(null);
    for (const item of [...found.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const restored = await deps.restoreProductStock(item.variantId, item.quantity);
      if (!restored.success) return restored;
    }
    return deps.saveStockRestoration(payload.orderId, payload.companyId);
  });
  return result.success ? ok(undefined) : err({ ...result.error, retryable: result.error.code === "PERSISTENCE_UNAVAILABLE" });
}
