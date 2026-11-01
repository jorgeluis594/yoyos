import { describe, expect, test } from "vitest";
import type { MessageTrace } from "@core/src/features/orders/domain/reader/trace";
import { expectedStagesOf } from "@core/evals/lib/stage-facts";
import { legacyAnswerOf, stagedAnswerOf } from "@core/evals/lib/staged-answer";

const quote = (text: string) => ({ source: "current" as const, text });
const call = (stage: string, reading: "primary" | "confirming", costUsd: number | null) => ({ stage, reading, provider: "fake", model: "m", promptVersion: "v", usage: null, costUsd, durationMs: 1, attempts: 1 });
const intentStage = (kind: "requests" | "no_intent" | "unsure") => ({ call: call("intent", "primary", 0.0003),
  output: { stage: "intent", kind, ...(kind === "no_intent" ? { reason: "other" } : {}), ...(kind === "requests" ? { requests: [] } : {}), language: "es", addressSpans: [] } });
const extractionStage = (requests: readonly object[], reading: "primary" | "confirming" = "primary") => ({ call: call("extraction", reading, 0.0004), output: { stage: "extraction", requests } });
const resolutionStage = (productId: string) => ({ call: call("resolution", "primary", 0.0003), output: { stage: "resolution", resolutions: [{ request: "r1", kind: "chosen", productId, values: [] }] } });
const decision = (kind: string, productId: string | null = null) => ({ action: { kind: "set_quantity", request: "r1", item: null, pending: null, productId, variantId: null }, decision: kind });
const traceOf = (parts: Partial<Record<"stages" | "decisions" | "photo", unknown>>): MessageTrace =>
  ({ stages: [], decisions: [], photo: null, ...parts }) as unknown as MessageTrace;

const keys: Readonly<Record<string, string>> = { "id-polo": "polo-basico", "id-gorra": "gorra-trucker" };
const base = { outcomes: [] as readonly string[], notice: null as string | null, orderMatches: true as boolean | null, latencyMs: 1200, productKeyOf: (id: string) => keys[id] ?? null };

describe("the staged answer read from the reading trace", () => {
  test("reads the intent of the primary intent stage and ignores the confirming reading", () => {
    const trace = traceOf({ stages: [intentStage("no_intent")] });
    const answer = stagedAnswerOf({ ...base, trace, expected: expectedStagesOf({ outcomes: ["no_intent"] }) });
    expect(answer.intent).toBe("no_intent");
  });

  test("derives the intent from the outcomes when no intent stage ran", () => {
    expect(stagedAnswerOf({ ...base, trace: null, outcomes: ["added"], expected: expectedStagesOf({ outcomes: ["added"] }) }).intent).toBe("requests");
    expect(stagedAnswerOf({ ...base, trace: null, outcomes: ["questions"], expected: expectedStagesOf({ outcomes: ["questions"] }) }).intent).toBe("no_intent");
  });

  test("names the extracted fields the way the case states them, folding case and accents", () => {
    const request = { request: "r1", kind: "change_quantity", target: { kind: "none" }, quantity: { value: 3, mode: "set", quote: quote("3") }, price: { amount: 55, currency: "order", basis: "unit", quote: quote("55") },
      values: [{ attributeWords: quote("talla"), valueWords: quote("l") }, { attributeWords: null, valueWords: quote("BLANCO") }], changeVerb: null };
    const expected = expectedStagesOf({ stages: { fields: { quantity: "3", price: "55", Talla: "L", Color: "Blanco" } }, outcomes: ["quantity_changed"] });
    const answer = stagedAnswerOf({ ...base, trace: traceOf({ stages: [intentStage("requests"), extractionStage([request])] }), expected });
    expect(answer.fields).toEqual({ quantity: "3", price: "55", Talla: "L", Color: "Blanco" });
  });

  test("reads no fields when the extraction stage did not run and ignores the confirming extraction", () => {
    const expected = expectedStagesOf({ stages: { fields: { quantity: "1" } }, outcomes: ["added"] });
    expect(stagedAnswerOf({ ...base, trace: traceOf({ stages: [intentStage("requests")] }), expected }).fields).toBeNull();
    const confirming = extractionStage([{ request: "r1", kind: "add", target: { kind: "none" }, quantity: { value: 9, mode: "add", quote: quote("9") }, price: null, values: [], changeVerb: null }], "confirming");
    expect(stagedAnswerOf({ ...base, trace: traceOf({ stages: [intentStage("requests"), confirming] }), expected }).fields).toBeNull();
  });

  test("takes the product of the decision, else of the resolution", () => {
    const expected = expectedStagesOf({ stages: { product: "polo-basico" }, outcomes: ["added"] });
    expect(stagedAnswerOf({ ...base, trace: traceOf({ stages: [resolutionStage("id-gorra")], decisions: [decision("applied", "id-polo")] }), expected }).product).toBe("polo-basico");
    expect(stagedAnswerOf({ ...base, trace: traceOf({ stages: [resolutionStage("id-gorra")] }), expected }).product).toBe("gorra-trucker");
    expect(stagedAnswerOf({ ...base, trace: traceOf({}), expected }).product).toBeNull();
  });

  test("the decision is the notice when there is one, else the most severe decision of the trace", () => {
    const expected = expectedStagesOf({ outcomes: ["added"] });
    expect(stagedAnswerOf({ ...base, notice: "variant_only", trace: traceOf({ decisions: [decision("applied")] }), expected }).decision).toBe("urgent");
    expect(stagedAnswerOf({ ...base, notice: "ready", trace: traceOf({}), expected }).decision).toBe("notice");
    expect(stagedAnswerOf({ ...base, trace: traceOf({ decisions: [decision("applied"), decision("doubtful")] }), expected }).decision).toBe("doubtful");
    expect(stagedAnswerOf({ ...base, trace: traceOf({ decisions: [decision("applied"), decision("pending")] }), expected }).decision).toBe("pending");
    expect(stagedAnswerOf({ ...base, trace: null, outcomes: ["no_intent"], expected }).decision).toBe("silent");
  });

  test("states what the message left for the silent-change and ignored-request counts", () => {
    const expected = expectedStagesOf({ outcomes: ["added"] });
    const doubtful = stagedAnswerOf({ ...base, trace: traceOf({ decisions: [decision("doubtful")] }), expected });
    expect(doubtful).toMatchObject({ changeApplied: true, marked: true, point: false, noticed: false });
    const pending = stagedAnswerOf({ ...base, trace: traceOf({ decisions: [decision("pending")] }), expected });
    expect(pending).toMatchObject({ changeApplied: false, marked: false, point: true });
    const changed = stagedAnswerOf({ ...base, notice: "order_changed_after_link", trace: null, expected });
    expect(changed).toMatchObject({ noticed: true, changedNotice: true });
    expect(stagedAnswerOf({ ...base, orderMatches: null, trace: null, expected }).orderMatches).toBeNull();
  });

  test("adds the cost of every stage by name, the confirming ones apart, and of the photo by method", () => {
    const trace = traceOf({ stages: [intentStage("requests"), extractionStage([]), extractionStage([], "confirming"), resolutionStage("id-polo")],
      photo: { method: "visual", costUsd: 0.0008 } });
    const answer = stagedAnswerOf({ ...base, trace, expected: expectedStagesOf({ outcomes: ["added"] }) });
    expect(answer.stageCostsUsd).toEqual({ intent: 0.0003, extraction: 0.0004, confirming_extraction: 0.0004, resolution: 0.0003, photo_visual: 0.0008 });
    expect(stagedAnswerOf({ ...base, trace: traceOf({ photo: { method: "none", costUsd: null } }), expected: expectedStagesOf({ outcomes: ["added"] }) }).stageCostsUsd).toEqual({});
  });

  test("reports the wall time of the reading and no queue wait", () => {
    const answer = stagedAnswerOf({ ...base, latencyMs: 4321, trace: null, expected: expectedStagesOf({ outcomes: ["added"] }) });
    expect(answer).toMatchObject({ readingMs: 4321, queuedMs: 0 });
  });
});

describe("the legacy answer read from the shadow reader", () => {
  const expected = expectedStagesOf({ outcomes: ["added"] });
  const shadow = (answer: "actions" | "no_intent" | "doubt" | "fixed", costUsd: number | null) => ({ answer, actionKinds: answer === "actions" ? ["add"] : [], usage: null, costUsd });

  test("answers the intent and the cost, and states no field, product or decision", () => {
    const actions = legacyAnswerOf({ shadow: shadow("actions", 0.0011), expected, latencyMs: 900 });
    expect(actions).toMatchObject({ intent: "requests", fields: null, product: null, changeApplied: true, readingMs: 900, stageCostsUsd: { legacy: 0.0011 } });
    expect(legacyAnswerOf({ shadow: shadow("no_intent", 0.0009), expected, latencyMs: 900 })).toMatchObject({ intent: "no_intent", changeApplied: false });
    expect(legacyAnswerOf({ shadow: shadow("doubt", 0.001), expected, latencyMs: 900 }).intent).toBe("unsure");
  });

  test("a legacy reading that failed costs nothing and leaves nothing", () => {
    expect(legacyAnswerOf({ shadow: null, expected, latencyMs: 900 })).toMatchObject({ intent: "unsure", changeApplied: false, stageCostsUsd: {} });
  });
});
