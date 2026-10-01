import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-pending-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";

type ReadAggregateError = Readonly<{ code: "INVALID_ORDER" | "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

export async function getOrderAggregate(id: OrderId, context: OrderAccess,
  findOrder: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, ReadAggregateError>>): Promise<Result<OrderAggregate, ReadAggregateError>> {
  if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_ORDER", message: "Invalid order ID" });
  const found = await findOrder(id, context.companyId);
  return found.success ? found.data ? ok(found.data) : err({ code: "ORDER_NOT_FOUND", message: "Order not found" }) : found;
}
