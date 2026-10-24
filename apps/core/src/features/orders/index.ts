import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { log } from "@core/src/shared/infrastructure/logger";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
export { orders } from "@core/src/features/orders/composition";
export type { OrderCancelled } from "@core/src/features/orders/application/events";
export type { OrderId, CompanyId } from "@core/src/features/orders/domain/order";

/** Read-only public read: the company's orders among these ids as the API aggregate contract (unknown ids are absent), one query. */
export async function getOrderAggregateResponsesByIds(ids: readonly string[], companyId: string):
  Promise<Result<readonly OrderAggregateResponse[], Readonly<{ code: "INVALID_ORDER" | "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  const found = await orders.getAggregatesByIds(ids as OrderId[], companyId as CompanyId);
  if (!found.success) return found;
  try {
    return ok(found.data.map(toOrderAggregateJson));
  } catch (cause) {
    log.error({ event: "order_aggregate_response_invalid", errorCode: "INVALID_ORDER", err: cause }, "order_aggregate_response_invalid");
    return err({ code: "INVALID_ORDER", message: "Invalid stored order" });
  }
}
