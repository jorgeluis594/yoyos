import { describe, expect, test } from "vitest";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { buildMessageTrace } from "@core/src/features/orders/application/reader/build-message-trace";
import type { BuildMessageTraceInput } from "@core/src/features/orders/application/reader/trace-ports";
import type { ReadingContextData } from "@core/src/features/orders/application/reader/load-reading-context";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { DecidedAction } from "@core/src/features/orders/domain/reader/decide-changes";
import type { ContextMessageRef, IntentReading, ItemRef, PendingRef, RequestRef, StageCall } from "@core/src/features/orders/domain/reader/readings";
import { maxTraceQuoteChars, traceDecisionsSchema, tracePhotoSchema, traceQuotesSchema, traceStagesSchema } from "@core/src/features/orders/domain/reader/trace";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const receivedAt = new Date("2026-11-01T10:00:00Z");
const call = (costUsd: number | null): StageCall => ({ stage: "intent", reading: "primary", provider: "fake", model: "m", promptVersion: "intent-v1", usage: null, costUsd, durationMs: 5, attempts: 1 });
const summary = { refs: [], productIds: [], productNames: [], candidateIds: [] };
const m1 = "M1" as ContextMessageRef;
const m2 = "M2" as ContextMessageRef;

const intentReading = (over: Partial<Extract<IntentReading, { kind: "requests" }>> = {}): IntentReading => ({
  kind: "requests", language: "es", addresses: [],
  requests: [{ id: "R1" as RequestRef, kind: "add", quote: { source: "current", text: "llámame al 987654321" } }], ...over });

const context = (over: Partial<ReadingContextData> = {}): ReadingContextData => ({
  input: { current: { messageId: id(1) as ChatMessageId, kind: "text", text: "x" }, items: [], pendings: [], photoMemory: null, photo: null,
    context: [
      { ref: m1, direction: "incoming", kind: "text", text: "vivo en Av. Lima 123", sentAt: receivedAt, masked: false },
      { ref: m2, direction: "incoming", kind: "text", text: "ya masked 987••••21", sentAt: receivedAt, masked: true },
    ] },
  contextMessageIds: new Map([[m1, id(2) as ChatMessageId], [m2, id(3) as ChatMessageId]]),
  masks: new Map([[id(3) as ChatMessageId, "ya masked 987••••21"]]),
  ...over } as unknown as ReadingContextData);

const input = (over: Partial<BuildMessageTraceInput> = {}): BuildMessageTraceInput => ({
  message: { id: id(1) as ChatMessageId, companyId: id(9) as CompanyId, receivedAt, text: "llámame al 987654321, vivo en Av. Lima 123", caption: null },
  retentionDays: 90, startedAt: receivedAt, decidedAt: receivedAt, queuedMs: 4, shadowWaitMs: null,
  intent: intentReading({ addresses: [{ message: "current", text: "Av. Lima 123" }, { message: m1, text: "Av. Lima 123" }] }), context: context(), photo: null,
  records: [], requests: [], intents: [], decisions: [], shadow: null, ...over });

describe("buildMessageTrace", () => {
  test("masks the current text and the unmasked context, and creates no mask for a text already masked", () => {
    const { trace, masks } = buildMessageTrace(input());
    expect(masks.map(({ messageId, text }) => [messageId, text])).toEqual([
      [id(1), "llámame al 987••••21, vivo en [dirección]"],
      [id(2), "vivo en [dirección]"],
    ]);
    expect(trace.contextMessageIds).toEqual([id(2), id(3)]);
    expect(trace.textState).toBe("masked");
    expect(trace.expiresAt).toEqual(new Date("2027-01-30T10:00:00Z"));
    expect(masks.every(({ expiresAt }) => expiresAt.getTime() === trace.expiresAt.getTime())).toBe(true);
  });

  test("withholds every text when the intent stage did not answer", () => {
    const { trace, masks } = buildMessageTrace(input({ intent: null }));
    expect(trace.textState).toBe("withheld");
    expect(masks).toEqual([]);
  });

  test("a caption is the current text when the message has no text", () => {
    const { masks } = buildMessageTrace(input({ context: null, message: { ...input().message, text: null, caption: "pago al 987654321" } }));
    expect(masks.map(({ text }) => text)).toEqual(["pago al 987••••21"]);
  });

  test("stores quote i as the masked quote of request i, cut at the limit", () => {
    const long = `${"a".repeat(70)} 987654321 ${"b".repeat(20)}`;
    const intents = [
      { id: "R1" as RequestRef, kind: "add" as const, quote: { source: "current" as const, text: "llámame al 987654321" } },
      { id: "R2" as RequestRef, kind: "add" as const, quote: { source: "context" as const, ref: m1, text: "Av. Lima 123" } },
      { id: "R3" as RequestRef, kind: "add" as const, quote: { source: "current" as const, text: long } },
    ];
    const requests = (["R2", "R1", "R3"] as const).map((request) => ({ request: { request: request as RequestRef }, complete: true })) as unknown as BuildMessageTraceInput["requests"];
    const { trace } = buildMessageTrace(input({ intents, requests }));
    expect(trace.quotes.map(({ id: quoteId }) => quoteId)).toEqual([0, 1, 2]);
    expect(trace.quotes.slice(0, 2).map(({ text }) => text)).toEqual(["[dirección]", "llámame al 987••••21"]);
    expect(trace.quotes[2]?.text.length).toBeLessThanOrEqual(maxTraceQuoteChars);
    expect(trace.quotes[2]?.text).not.toContain("987654321");
  });

  test("keeps the stages that made a call, sums the costs and builds the decisions with the refs of the context", () => {
    const variantId = id(7) as VariantId;
    const decided = { checked: { request: "R1" as RequestRef, signals: { quotesComplete: true, targetNamed: "named", variantChangeVerb: "present", candidates: "single" },
      action: { kind: "remove", amount: "all", target: { kind: "variant", variantId } } }, risk: "high", agreement: "agree", decision: { kind: "doubtful", reason: "x" } } as unknown as DecidedAction;
    const withItem = context({ input: { ...context().input, items: [{ ref: "I1" as ItemRef, variantId, productId: id(5) }], pendings: [{ ref: "Q1" as PendingRef }] } as never });
    const { trace } = buildMessageTrace(input({
      context: withItem, decisions: [decided],
      photo: { method: "visual", result: "matched", productId: id(5) as never, confidence: 0.9, usage: null, costUsd: 0.5, durationMs: 1 },
      records: [{ call: call(0.25), stage: "intent", input: summary, output: null, errorCode: null }, { call: null, stage: "extraction", input: summary, output: null, errorCode: "DEADLINE_EXCEEDED" }],
    }));
    // What saveMessageTrace parses before it writes.
    expect(traceStagesSchema.safeParse(trace.stages).success).toBe(true);
    expect(traceDecisionsSchema.safeParse(trace.decisions).success).toBe(true);
    expect(tracePhotoSchema.safeParse(trace.photo).success).toBe(true);
    expect(traceQuotesSchema.safeParse(buildMessageTrace(input()).trace.quotes).success).toBe(true);
    expect(trace.stages).toHaveLength(1);
    expect(trace.costUsd).toBeCloseTo(0.75);
    expect(trace.decisions).toEqual([{ action: { kind: "remove", request: "R1", item: "I1", pending: null, productId: id(5), variantId }, signals: decided.checked.signals,
      risk: "high", agreement: "agree", decision: "doubtful" }]);
  });

  test("has no cost when no call reported one", () => {
    expect(buildMessageTrace(input({ records: [{ call: call(null), stage: "intent", input: summary, output: null, errorCode: null }] })).trace.costUsd).toBeNull();
  });
});
