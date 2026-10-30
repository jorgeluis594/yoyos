import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId } from "@core/src/features/orders/domain/order";

/** Whether the company has at least one visible order (unconfirmed catalog orders do not count). */
export function hasAnyOrder(_input: Record<string, never>, context: OrderAccess,
  existsOrder: (companyId: CompanyId) => Promise<Result<boolean, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>>) {
  return existsOrder(context.companyId);
}
