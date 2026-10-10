import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { Result } from "@shared/result";
import type { EventBusError } from "@core/src/shared/events/application/contracts";

export type OrderCancelled = Readonly<{ orderId: OrderId; companyId: CompanyId }>;
declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents { order_cancelled: OrderCancelled }
}
export type PublishOrderCancelled = (payload: OrderCancelled) => Promise<Result<void, EventBusError>>;
