import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId } from "@core/src/features/orders/domain/order";

type ReadByNumberError = Readonly<{ code: "INVALID_ORDER" | "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** The company's order with this number. Another company's number and an unconfirmed catalog order answer the same `ORDER_NOT_FOUND`. */
export async function getOrderAggregateByNumber(input: Readonly<{ number: OrderNumber }>, context: OrderAccess,
  findOrderByNumber: (number: OrderNumber, companyId: CompanyId) => Promise<Result<OrderAggregate | null, ReadByNumberError>>): Promise<Result<OrderAggregate, ReadByNumberError>> {
  const found = await findOrderByNumber(input.number, context.companyId);
  return found.success ? found.data ? ok(found.data) : err({ code: "ORDER_NOT_FOUND", message: "Order not found" }) : found;
}
