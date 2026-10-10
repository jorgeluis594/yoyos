import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type RejectCode = "INVALID_INPUT" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE";

export type SyncStateName = "pending" | "synced" | "rejected" | "orphaned";

/** Failure of a registration attempt, reduced to what the policy needs. */
export type SyncFailure = Readonly<{ code: string; httpStatus: number | null }>;

export type SyncDecision =
  | Readonly<{ action: "reject"; code: RejectCode }>
  | Readonly<{ action: "block" }>
  | Readonly<{ action: "cancel" }>
  | Readonly<{ action: "retry"; stopBatch: boolean }>;

const blockingCodes = ["UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY", "SECURE_STORAGE_ERROR"];
const batchStoppingCodes = ["NETWORK_ERROR", "RATE_LIMITED"];

export function classifyFailure(failure: SyncFailure): SyncDecision {
  if (failure.code === "OPERATION_CANCELLED") return { action: "cancel" };
  if (failure.code === "UNSUPPORTED_MEDIA_TYPE") return { action: "reject", code: "UNSUPPORTED_MEDIA_TYPE" };
  if (blockingCodes.includes(failure.code)) return { action: "block" };
  if (failure.code === "API_ERROR") {
    if (failure.httpStatus === 400) return { action: "reject", code: "INVALID_INPUT" };
    if (failure.httpStatus === 413) return { action: "reject", code: "PAYLOAD_TOO_LARGE" };
    if (failure.httpStatus === 403) return { action: "block" };
  }
  return { action: "retry", stopBatch: batchStoppingCodes.includes(failure.code) };
}

const maximumBackoffSeconds = 300;
const jitterRatio = 0.2;

/** `random` is a value in [0, 1) supplied by the caller. Returns milliseconds. */
export function retryDelayMs(attempts: number, random: number): number {
  const base = Math.min(2 ** attempts, maximumBackoffSeconds) * 1000;
  return Math.round(base * (1 + (random * 2 - 1) * jitterRatio));
}

const allowedTransitions: Readonly<Record<SyncStateName, readonly SyncStateName[]>> = {
  pending: ["synced", "rejected", "pending"],
  synced: [],
  rejected: [],
  orphaned: [],
};

export type TransitionError = Readonly<{ code: "INVALID_TRANSITION"; message: string }>;

export function transition(from: SyncStateName, to: SyncStateName): Result<SyncStateName, TransitionError> {
  return allowedTransitions[from].includes(to)
    ? ok(to)
    : err({ code: "INVALID_TRANSITION", message: `Cannot move from ${from} to ${to}` });
}
