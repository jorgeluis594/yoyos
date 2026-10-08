import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { EventBusError } from "@core/src/shared/events/application/contracts";
import type { OrderCancelled } from "@core/src/features/orders/application/events";
import { isCompanyId, isOrderId } from "@core/src/features/orders/domain/order";

const schema = z.strictObject({ orderId: z.uuid(), companyId: z.uuid() });
export function parseOrderCancelled(input: unknown): Result<OrderCancelled, EventBusError> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return err({ code: "INVALID_EVENT", message: "Invalid order cancellation payload" });
  const { orderId, companyId } = parsed.data;
  if (!isOrderId(orderId) || !isCompanyId(companyId))
    return err({ code: "INVALID_EVENT", message: "Invalid order cancellation payload" });
  return ok({ orderId, companyId });
}
