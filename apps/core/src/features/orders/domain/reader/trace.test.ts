import { describe, expect, test } from "vitest";
import { maxTraceQuoteChars, traceDecisionsSchema, tracePhotoSchema, traceQuotesSchema, traceShadowSchema, traceStagesSchema } from "@core/src/features/orders/domain/reader/trace";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const usage = { inputTokens: 2600, cachedInputTokens: 1024, outputTokens: 150, reasoningTokens: 0 };
const call = { stage: "intent", reading: "primary", provider: "fake", model: "gpt-6-luna", promptVersion: "intent-v1", usage, costUsd: 0.00034, durationMs: 900, attempts: 1 };
const photo = { method: "visual", result: "matched", productId: id(1), confidence: 0.9, usage, costUsd: 0.001, durationMs: 700 };
const stage = { call, input: { refs: ["M1", "I1"], productIds: [id(1)], productNames: ["Polera"], candidateIds: [id(2)] }, output: { stage: "intent", kind: "unsure", language: "es", addressSpans: [{ message: "current", count: 1 }] }, errorCode: null };
const decision = { action: { kind: "add", request: "R1", item: null, pending: "Q1", productId: id(1), variantId: id(3) },
  signals: { quotesComplete: true, targetNamed: "named", variantChangeVerb: "not_applicable", candidates: "single" }, risk: "low", agreement: "not_run", decision: "applied" };
const shadow = { answer: "actions", actionKinds: ["add"], usage, costUsd: null };

const roundTrip = (schema: { parse(value: unknown): unknown }, value: unknown) => expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);

describe("trace schemas", () => {
  test("round-trip the photo, stages, quotes, decisions and shadow of a trace", () => {
    roundTrip(tracePhotoSchema, photo);
    roundTrip(tracePhotoSchema, { method: "none", result: "not_product", productId: null, confidence: null, usage: null, costUsd: null, durationMs: 0 });
    roundTrip(traceStagesSchema, [stage, { ...stage, output: null, errorCode: "INVALID_AI_RESPONSE", call: { ...call, usage: null, costUsd: null, attempts: 2 } }]);
    roundTrip(traceQuotesSchema, [{ id: 0, text: "la quiero en M" }]);
    roundTrip(traceDecisionsSchema, [decision]);
    roundTrip(traceShadowSchema, shadow);
    roundTrip(traceShadowSchema, { ...shadow, usage: null });
  });

  test.each([
    ["a photo with an unknown result", tracePhotoSchema, { ...photo, result: "blurry" }],
    ["a photo with a confidence above 1", tracePhotoSchema, { ...photo, confidence: 1.5 }],
    ["a stage of an unknown name", traceStagesSchema, [{ ...stage, call: { ...call, stage: "memory" } }]],
    ["a stage with a third attempt", traceStagesSchema, [{ ...stage, call: { ...call, attempts: 3 } }]],
    ["a stage input that holds prompt text", traceStagesSchema, [{ ...stage, input: { ...stage.input, prompt: "Eres un lector" } }]],
    ["a quote longer than the limit", traceQuotesSchema, [{ id: 0, text: "a".repeat(maxTraceQuoteChars + 1) }]],
    ["a decision with an unknown risk", traceDecisionsSchema, [{ ...decision, risk: "medium" }]],
    ["a decision with an extra field that could hold buyer text", traceDecisionsSchema, [{ ...decision, action: { ...decision.action, text: "quiero una polera" } }]],
    ["a shadow that keeps the legacy answer", traceShadowSchema, { ...shadow, raw: "{}" }],
    ["a shadow with an unknown answer", traceShadowSchema, { ...shadow, answer: "chat" }],
  ])("reject %s", (_title, schema, stored) => {
    expect(schema.safeParse(stored).success).toBe(false);
  });
});
