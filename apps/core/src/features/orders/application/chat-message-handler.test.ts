import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { createChatMessageDeadLetterHandler, createChatMessageHandler, type ChatMessageHandlerDependencies } from "@core/src/features/orders/application/chat-message-handler";
import { chatMessageDeadLetterPolicy, chatMessagePolicy, chatMessageDeadlineMs } from "@core/src/features/orders/application/chat-message-policy";
import type { ApplyChatMessageOutcome } from "@core/src/features/orders/application/apply-chat-message";

type Payload = Parameters<ReturnType<typeof createChatMessageHandler>>[0];
const payload = { companyId: "00000000-0000-4000-8000-000000000001", chatId: "00000000-0000-4000-8000-000000000003", messageId: "00000000-0000-4000-8000-000000000002" } as unknown as Payload;
const metadata = { eventId: payload.messageId, occurredAt: "2026-10-23T12:00:00.000Z" };
const context = (attempt = 1, signal = new AbortController().signal) => ({ attempt, signal });

const applied = (noticeDue: boolean): ApplyChatMessageOutcome => ({ kind: "applied", orderId: null, createdOrder: false,
  outcomes: noticeDue ? [{ kind: "unnamed_add" }] : [{ kind: "no_intent" }], noticeDue, pendingsBefore: 1, pendingsAfter: 0,
  trace: { readerCalls: 1, answer: "no_intent", actionKinds: [], usage: null, contextTruncated: false, candidateMs: 12, candidateMatchCount: 3, candidatesTimedOut: false } });

function harness(over: Partial<ChatMessageHandlerDependencies> = {}) {
  const published: unknown[] = [];
  const recorded: Array<[string, string]> = [];
  const deps: ChatMessageHandlerDependencies = {
    withTenant: (_company, work) => work(),
    apply: async () => ok(applied(false)),
    recordFailedOutcome: async (messageId, code) => { recorded.push([messageId, code]); return ok({ publishNotice: true }); },
    publishNotice: async (notice) => { published.push(notice); return ok(undefined); },
    deadlineMs: chatMessageDeadlineMs, retries: chatMessagePolicy.retries,
    ...over,
  };
  return { deps, published, recorded, handle: createChatMessageHandler(deps), handleDeadLetter: createChatMessageDeadLetterHandler(deps) };
}

beforeEach(() => { vi.spyOn(log, "info").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe("apply-chat-message handler", () => {
  test("publishes the notice after the commit only when a notice is due", async () => {
    const quiet = harness();
    expect(await quiet.handle(payload, metadata, context())).toEqual(ok(undefined));
    expect(quiet.published).toEqual([]);
    const due = harness({ apply: async () => ok(applied(true)) });
    expect(await due.handle(payload, metadata, context())).toEqual(ok(undefined));
    expect(due.published).toEqual([{ companyId: payload.companyId, messageId: payload.messageId }]);
  });

  test("publishes the notice for an already processed message whose notice is due", async () => {
    const h = harness({ apply: async () => ok({ kind: "already_processed", noticeDue: true }) });
    expect(await h.handle(payload, metadata, context())).toEqual(ok(undefined));
    expect(h.published).toHaveLength(1);
    const none = harness({ apply: async () => ok({ kind: "already_processed", noticeDue: false }) });
    await none.handle(payload, metadata, context());
    expect(none.published).toHaveLength(0);
  });

  test("completes without a notice for a skipped message", async () => {
    const h = harness({ apply: async () => ok({ kind: "skipped", reason: "empty_text" }) });
    expect(await h.handle(payload, metadata, context())).toEqual(ok(undefined));
    expect(h.published).toEqual([]);
  });

  test("returns a retryable failure for provider unavailability and records nothing", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const h = harness({ apply: async () => err({ code: "AI_PROVIDER_UNAVAILABLE", message: "down" }) });
    expect(await h.handle(payload, metadata, context(2))).toEqual(err({ code: "AI_PROVIDER_UNAVAILABLE", message: "down", retryable: true }));
    expect(h.recorded).toEqual([]);
    expect(h.published).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "orders_chat_message_retry_scheduled", errorCode: "AI_PROVIDER_UNAVAILABLE", attempt: 2 }), expect.any(String));
  });

  test("treats every transient code as retryable", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    for (const code of ["PERSISTENCE_UNAVAILABLE", "IMAGE_STORAGE_UNAVAILABLE", "QR_READER_UNAVAILABLE", "EMBEDDER_UNAVAILABLE", "PRODUCT_MATCHER_UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE", "DEADLINE_EXCEEDED"] as const) {
      const h = harness({ apply: async () => err({ code, message: "x" }) });
      expect(await h.handle(payload, metadata, context())).toMatchObject({ success: false, error: { code, retryable: true } });
    }
  });

  test("records a failed outcome, publishes the notice and completes on a permanent error", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const h = harness({ apply: async () => err({ code: "INVALID_AI_RESPONSE", message: "bad" }) });
    expect(await h.handle(payload, metadata, context())).toEqual(ok(undefined));
    expect(h.recorded).toEqual([[payload.messageId, "INVALID_AI_RESPONSE"]]);
    expect(h.published).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "orders_chat_message_failed", source: "permanent", errorCode: "INVALID_AI_RESPONSE" }), expect.any(String));
  });

  test("publishes no notice for a permanent error on a message that already has an outcome", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const h = harness({ apply: async () => err({ code: "INVALID_ORDER", message: "bad" }), recordFailedOutcome: async () => ok({ publishNotice: false }) });
    expect(await h.handle(payload, metadata, context())).toEqual(ok(undefined));
    expect(h.published).toEqual([]);
  });

  test("returns a retryable failure when the failed outcome cannot be recorded", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const h = harness({ apply: async () => err({ code: "INVALID_AI_RESPONSE", message: "bad" }), recordFailedOutcome: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
    expect(await h.handle(payload, metadata, context())).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", retryable: true } });
    expect(h.published).toEqual([]);
  });

  test("completes and logs when publishing the notice fails after the commit", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const h = harness({ apply: async () => ok(applied(true)), publishNotice: async () => err({ code: "EVENT_BUS_UNAVAILABLE", message: "down" }) });
    expect(await h.handle(payload, metadata, context())).toEqual(ok(undefined));
    expect(warn).toHaveBeenCalledWith({ event: "orders_chat_message_notice_publish_failed", companyId: payload.companyId, messageId: payload.messageId, eventId: metadata.eventId,
      errorCode: "EVENT_BUS_UNAVAILABLE" }, expect.any(String));
  });

  test("logs the applied message without any text, caption or product name", async () => {
    await harness({ apply: async () => ok(applied(true)) }).handle(payload, metadata, context(3));
    const [fields] = vi.mocked(log.info).mock.calls[0]!;
    expect(Object.keys(fields as object).sort()).toEqual(["actionKinds", "answer", "attempt", "candidateMatchCount", "candidateMs", "candidatesTimedOut", "chatId", "companyId", "contextTruncated", "createdOrder",
      "durationMs", "event", "eventId", "messageId", "noticeDue", "orderId", "outcomeKinds", "pendingsAfter", "pendingsBefore", "readerCalls"]);
    expect(fields).toMatchObject({ event: "orders_chat_message_applied", outcomeKinds: ["unnamed_add"], attempt: 3 });
  });

  test("gives the attempt a signal that aborts at the deadline and with the job", async () => {
    let seen!: AbortSignal;
    const h = harness({ deadlineMs: 20, apply: async (_input, signal) => { seen = signal; await new Promise((resolve) => signal.addEventListener("abort", resolve)); return err({ code: "DEADLINE_EXCEEDED", message: "late" }); } });
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    expect(await h.handle(payload, metadata, context())).toMatchObject({ success: false, error: { retryable: true } });
    expect(seen.aborted).toBe(true);
    const job = new AbortController();
    const early = harness({ apply: async (_input, signal) => { job.abort(); return ok(applied(!signal.aborted)); } });
    await early.handle(payload, metadata, context(1, job.signal));
    expect(early.published).toEqual([]);
  });

  test("runs the work inside the company's tenant isolation", async () => {
    const companies: string[] = [];
    const h = harness({ withTenant: (company, work) => { companies.push(company); return work(); } });
    await h.handle(payload, metadata, context());
    expect(companies).toEqual([payload.companyId]);
  });
});

describe("apply-chat-message dead-letter handler", () => {
  test("records failed, publishes the notice and succeeds once", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const h = harness();
    expect(await h.handleDeadLetter(payload, metadata, context(1))).toEqual(ok(undefined));
    expect(h.recorded).toEqual([[payload.messageId, "RETRIES_EXHAUSTED"]]);
    expect(h.published).toHaveLength(1);
  });

  test("keeps an existing outcome and publishes nothing for it", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const h = harness({ recordFailedOutcome: async () => ok({ publishNotice: false }) });
    expect(await h.handleDeadLetter(payload, metadata, context())).toEqual(ok(undefined));
    expect(h.published).toEqual([]);
  });

  test("publishes for an existing outcome only when its notice is due and unsent", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const due = harness({ recordFailedOutcome: async () => ok({ publishNotice: true }) });
    await due.handleDeadLetter(payload, metadata, context());
    expect(due.published).toHaveLength(1);
  });

  test("never ends in a permanent error: a database failure is retried", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    for (const code of ["PERSISTENCE_UNAVAILABLE", "INVALID_STORED_DATA"]) {
      const h = harness({ recordFailedOutcome: async () => err({ code, message: "x" }) });
      expect(await h.handleDeadLetter(payload, metadata, context())).toMatchObject({ success: false, error: { retryable: true } });
    }
  });

  test("still succeeds when the notice cannot be published", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const h = harness({ publishNotice: async () => err({ code: "EVENT_BUS_UNAVAILABLE", message: "down" }) });
    expect(await h.handleDeadLetter(payload, metadata, context())).toEqual(ok(undefined));
  });
});

describe("apply-chat-message policy", () => {
  test("orders by chat, groups by company and bounds a company to half of a worker's slots", () => {
    expect(chatMessagePolicy.orderingKey?.(payload)).toBe(payload.chatId);
    expect(chatMessagePolicy.groupKey?.(payload)).toBe(payload.companyId);
    expect(chatMessagePolicy.groupConcurrency).toBe(8);
    expect(chatMessagePolicy.concurrency).toBe(16);
  });

  test("a provider that never answers ends in the dead-letter path within 25 minutes", () => {
    const { retries, retryDelaySeconds, retryDelayMaxSeconds = 0, expireInSeconds = 0 } = chatMessagePolicy;
    const superviseIntervalSeconds = 10;
    // pg-boss waits delay · 2^n · (1 + random), at most twice the base, capped.
    const waits = Array.from({ length: retries }, (_, attempt) => Math.min(retryDelaySeconds * 2 ** attempt * 2, retryDelayMaxSeconds));
    const attempts = (retries + 1) * (expireInSeconds + superviseIntervalSeconds);
    expect(waits.reduce((sum, wait) => sum + wait, 0) + attempts).toBeLessThanOrEqual(25 * 60);
    expect(chatMessageDeadlineMs / 1000).toBeLessThan(expireInSeconds);
  });

  test("the dead-letter queue retries every 30 seconds without growing", () => {
    expect(chatMessageDeadLetterPolicy).toMatchObject({ retries: 8, retryDelaySeconds: 30, exponentialBackoff: false });
  });
});
