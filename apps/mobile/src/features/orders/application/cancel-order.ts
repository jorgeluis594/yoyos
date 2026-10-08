import { ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type CancelledOrderState = Readonly<{
  id: string; status: "cancelled"; cancelled: true; deliveryStatus: "pending";
  stockDeducted: boolean; deliveredAt: null; completedAt: null;
}>;
export type CancellationOrderState = CancelledOrderState
  | Readonly<{ id: string; status: "active"; cancelled: false; deliveryStatus: "pending" }>
  | Readonly<{ id: string; status: "active" | "completed"; cancelled: false; deliveryStatus: "shipped" | "delivered" }>;
export type CancellationRequestError = Readonly<{ code:
  | "INVALID_INPUT" | "ORDER_NOT_FOUND" | "INVALID_TRANSITION" | "INVALID_ORDER" | "INVALID_PAYMENT" | "CURRENCY_MISMATCH"
  | "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "INVALID_COMPANY" | "OPERATION_CANCELLED" | "SECURE_STORAGE_ERROR"
  | "NETWORK_ERROR" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "SERVER_ERROR" | "INVALID_RESPONSE";
  message: string;
}>;
export type CancellationRecoveryError = CancellationRequestError & Readonly<{ code: "RATE_LIMITED" | "NETWORK_ERROR" | "SERVICE_UNAVAILABLE" | "SERVER_ERROR" | "INVALID_RESPONSE" }>;
export type CancelOrderOutcome =
  | Readonly<{ kind: "cancelled"; order: CancelledOrderState }>
  | Readonly<{ kind: "still_active"; order: Extract<CancellationOrderState, { deliveryStatus: "pending"; cancelled: false }> }>
  | Readonly<{ kind: "dispatched"; order: Extract<CancellationOrderState, { deliveryStatus: "shipped" | "delivered" }> }>
  | Readonly<{ kind: "uncertain"; orderId: string; cause: CancellationRecoveryError }>;
export type CancellationDependencies = Readonly<{
  cancel: (orderId: string) => Promise<Result<CancelledOrderState, CancellationRequestError>>;
  readState: (orderId: string) => Promise<Result<CancellationOrderState, CancellationRequestError>>;
}>;
export type CancelOrderOperation = (orderId: string) => Promise<Result<CancelOrderOutcome, CancellationRequestError>>;
export type CancellationOperations = Readonly<{ cancelOrder: CancelOrderOperation; checkCancellation: CancelOrderOperation }>;

function isRecoveryError(error: CancellationRequestError): error is CancellationRecoveryError {
  return error.code === "RATE_LIMITED" || error.code === "NETWORK_ERROR" || error.code === "SERVICE_UNAVAILABLE" || error.code === "SERVER_ERROR" || error.code === "INVALID_RESPONSE";
}
export function createCancellationOperations(deps: CancellationDependencies): CancellationOperations {
  const checkCancellation: CancelOrderOperation = async id => {
    const found = await deps.readState(id);
    if (!found.success) return isRecoveryError(found.error) ? ok({ kind: "uncertain", orderId: id, cause: found.error }) : found;
    if (found.data.cancelled) return ok({ kind: "cancelled", order: found.data });
    if (found.data.deliveryStatus === "pending") return ok({ kind: "still_active", order: found.data });
    return ok({ kind: "dispatched", order: found.data });
  };
  return {
    checkCancellation,
    cancelOrder: async id => {
      const result = await deps.cancel(id);
      if (result.success) return ok({ kind: "cancelled", order: result.data });
      return (isRecoveryError(result.error) && result.error.code !== "RATE_LIMITED") || result.error.code === "INVALID_TRANSITION" ? checkCancellation(id) : result;
    },
  };
}
