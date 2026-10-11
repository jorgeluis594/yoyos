import { classifyFailure, retryDelayMs, transition, type SyncStateName } from "@mobile/features/whatsapp/domain/sync-policy";

const failure = (code: string, httpStatus: number | null = null) => classifyFailure({ code, httpStatus });

test("classifies INVALID_INPUT, PAYLOAD_TOO_LARGE and UNSUPPORTED_MEDIA_TYPE as rejected", () => {
  expect(failure("API_ERROR", 400)).toEqual({ action: "reject", code: "INVALID_INPUT" });
  expect(failure("API_ERROR", 413)).toEqual({ action: "reject", code: "PAYLOAD_TOO_LARGE" });
  expect(failure("UNSUPPORTED_MEDIA_TYPE", 415)).toEqual({ action: "reject", code: "UNSUPPORTED_MEDIA_TYPE" });
});

test("classifies UNAUTHENTICATED, COMPANY_REQUIRED, INVALID_COMPANY and EMAIL_VERIFICATION_REQUIRED as session blocked", () => {
  for (const code of ["UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY"]) expect(failure(code)).toEqual({ action: "block" });
  expect(failure("API_ERROR", 403)).toEqual({ action: "block" });
});

test("classifies NETWORK_ERROR, SERVICE_UNAVAILABLE, SERVER_ERROR, RATE_LIMITED and INVALID_RESPONSE as retry", () => {
  for (const code of ["NETWORK_ERROR", "SERVICE_UNAVAILABLE", "SERVER_ERROR", "RATE_LIMITED", "INVALID_RESPONSE"])
    expect(failure(code)).toMatchObject({ action: "retry" });
});

test("keeps OPERATION_CANCELLED pending without counting an attempt", () => {
  expect(failure("OPERATION_CANCELLED")).toEqual({ action: "cancel" });
});

test("continues the batch after server errors and stops it after network or rate-limit errors", () => {
  expect(failure("SERVER_ERROR")).toEqual({ action: "retry", stopBatch: false });
  expect(failure("SERVICE_UNAVAILABLE")).toEqual({ action: "retry", stopBatch: false });
  expect(failure("NETWORK_ERROR")).toEqual({ action: "retry", stopBatch: true });
  expect(failure("RATE_LIMITED")).toEqual({ action: "retry", stopBatch: true });
});

test("classifies every TransportError code", () => {
  const codes = ["UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY", "INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE",
    "IMAGE_STORAGE_UNAVAILABLE", "NOT_FOUND", "SERVICE_UNAVAILABLE", "NETWORK_ERROR", "RATE_LIMITED", "SERVER_ERROR", "INVALID_RESPONSE",
    "OPERATION_CANCELLED", "SECURE_STORAGE_ERROR", "API_ERROR"];
  for (const code of codes) expect(["reject", "block", "cancel", "retry"]).toContain(failure(code).action);
});

test("doubles the backoff per attempt and caps it at 300 seconds", () => {
  expect([0, 1, 2, 3].map((attempts) => retryDelayMs(attempts, 0.5))).toEqual([1000, 2000, 4000, 8000]);
  expect(retryDelayMs(8, 0.5)).toBe(256_000);
  expect(retryDelayMs(9, 0.5)).toBe(300_000);
  expect(retryDelayMs(50, 0.5)).toBe(300_000);
});

test("keeps the jitter within 20 percent of the backoff", () => {
  expect(retryDelayMs(5, 0)).toBe(25_600);
  expect(retryDelayMs(5, 0.999999)).toBeLessThanOrEqual(38_400);
  expect(retryDelayMs(5, 0.999999)).toBeGreaterThan(38_000);
});

test("allows pending to synced, rejected or pending", () => {
  for (const to of ["synced", "rejected", "pending"] as const) expect(transition("pending", to)).toEqual({ success: true, data: to });
});

test("rejects any transition out of synced, rejected or orphaned", () => {
  const all: SyncStateName[] = ["pending", "synced", "rejected", "orphaned"];
  for (const from of ["synced", "rejected", "orphaned"] as const)
    for (const to of all) expect(transition(from, to)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
});

test("rejects INVALID_MESSAGE as INVALID_INPUT instead of retrying it", () => {
  expect(failure("INVALID_MESSAGE")).toEqual({ action: "reject", code: "INVALID_INPUT" });
});
