import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-pending-order";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

export type DeductStockError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE"; message: string; variantId?: string }>;
export type DeductStockDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, DeductStockError>>) => Promise<Result<T, DeductStockError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, DeductStockError>>;
  deductProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, DeductStockError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId) => Promise<Result<null, DeductStockError>>;
}>;

export async function deductStock(id: OrderId, context: OrderAccess, deps: DeductStockDependencies): Promise<Result<OrderAggregate, DeductStockError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(id, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const plan = orderStateMachine.planStockDeduction(found.data, true);
    if (!plan.success) return plan;
    if (plan.data.kind === "none") return ok(plan.data.nextOrder);
    for (const item of [...found.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const deducted = await deps.deductProductStock(item.variantId, item.quantity);
      if (!deducted.success) return deducted;
    }
    const saved = await deps.saveStockDeduction(id, context.companyId);
    return saved.success ? ok(plan.data.nextOrder) : saved;
  });
}
