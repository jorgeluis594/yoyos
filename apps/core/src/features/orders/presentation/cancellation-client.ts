import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { cancelOrderResponseSchema, orderAggregateSchema, type OrderAggregateResponse } from "@shared/contracts/orders";
import type { CancelOrderError } from "@core/src/features/orders/application/cancel-order";

export type CancelOrderActionError = CancelOrderError | Readonly<{ code: "INVALID_INPUT" | "INTERNAL_ERROR"; message: string }>;
export type CancellationClientResult = Readonly<{ operation: "cancellation"; orderId: string; outcome:
  | Readonly<{ kind: "confirmed"; order: OrderAggregateResponse; refreshFailed?: boolean }>
  | Readonly<{ kind: "failed"; error: CancelOrderActionError; order?: OrderAggregateResponse; refreshFailed?: boolean }>
  | Readonly<{ kind: "uncertain"; cause: CancelOrderActionError }>
}>;
export type CancellationUiState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "submitting" | "verifying"; orderId: string }>
  | Readonly<{ kind: "failed"; error: CancelOrderActionError }>
  | Readonly<{ kind: "uncertain"; orderId: string; cause: CancelOrderActionError }>;

export async function readCancellationOrder(id: string): Promise<Result<OrderAggregateResponse, CancelOrderActionError>> {
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}/aggregate`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (response.status === 401 || response.status === 403) throw response;
    if (response.status === 404) return err({ code: "ORDER_NOT_FOUND", message: "Order unavailable" });
    if (!response.ok) return err({ code: "INTERNAL_ERROR", message: "Unable to read order" });
    const parsed = orderAggregateSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.id !== id || ((parsed.data.cancelled || parsed.data.status === "cancelled") && !cancelOrderResponseSchema.safeParse(parsed.data).success))
      return err({ code: "INTERNAL_ERROR", message: "Invalid order response" });
    return ok(parsed.data);
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    return err({ code: "INTERNAL_ERROR", message: "Unable to read order" });
  }
}

export async function verifyCancellation(id: string, cause: CancelOrderActionError,
  read: typeof readCancellationOrder = readCancellationOrder): Promise<CancellationClientResult> {
  const found = await read(id);
  if (!found.success) return { operation: "cancellation", orderId: id, outcome: found.error.code === "ORDER_NOT_FOUND"
    ? { kind: "failed", error: found.error } : cause.code === "INVALID_TRANSITION"
      ? { kind: "failed", error: cause, refreshFailed: true } : { kind: "uncertain", cause: found.error } };
  if (found.data.cancelled) return { operation: "cancellation", orderId: id, outcome: { kind: "confirmed", order: found.data } };
  return { operation: "cancellation", orderId: id, outcome: { kind: "failed", order: found.data, error: found.data.deliveryStatus !== "pending"
    ? { code: "INVALID_TRANSITION", message: "Order was dispatched" } : cause } };
}

export const cancellationMessage = {
  INVALID_INPUT: "invalid", ORDER_NOT_FOUND: "missing", INVALID_TRANSITION: "conflict", INVALID_ORDER: "inconsistent",
  INVALID_PAYMENT: "inconsistent", CURRENCY_MISMATCH: "inconsistent", PERSISTENCE_UNAVAILABLE: "retry", INTERNAL_ERROR: "retry",
} satisfies Record<CancelOrderActionError["code"], "invalid" | "missing" | "conflict" | "inconsistent" | "retry">;
