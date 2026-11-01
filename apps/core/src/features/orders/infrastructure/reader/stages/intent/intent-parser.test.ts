import { describe, expect, test } from "vitest";
import type { RequestKind } from "@core/src/features/orders/domain/reader/readings";
import { parseIntentAnswer, requestKinds } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent-parser";
import { contextMessage, readingInput } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent-test-support";

const input = readingInput({ context: [contextMessage(1), contextMessage(2, { masked: true })] });
const answer = (over: Record<string, unknown> = {}) => ({
  outcome: "requests", noIntentReason: null, language: "es",
  requests: [{ kind: "add", quote: { message: "current", text: "quiero dos" } }], addresses: [], ...over,
});

describe("intent parser", () => {
  test("accepts every request kind", () => {
    const kinds: readonly RequestKind[] = ["add", "remove", "change_quantity", "change_variant", "complete_pending", "decline", "mention_price", "ready", "payment_request", "not_allowed"];

    expect([...requestKinds].sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const parsed = parseIntentAnswer(answer({ requests: [{ kind, quote: { message: "current", text: "x" } }] }), input);

      expect(parsed).toMatchObject({ success: true, data: { kind: "requests", requests: [{ id: "R1", kind }] } });
    }
  });

  test("rejects an answer with an unknown request kind", () => {
    const parsed = parseIntentAnswer(answer({ requests: [{ kind: "cancel_order", quote: { message: "current", text: "x" } }] }), input);

    expect(parsed.success).toBe(false);
  });

  test("numbers the requests in the order given and keeps each quote with its source", () => {
    const parsed = parseIntentAnswer(answer({ requests: [
      { kind: "add", quote: { message: "current", text: "dos polos" } },
      { kind: "ready", quote: { message: "M1", text: "listo" } },
    ] }), input);

    expect(parsed).toEqual({ success: true, data: { kind: "requests", language: "es", addresses: [], requests: [
      { id: "R1", kind: "add", quote: { source: "current", text: "dos polos" } },
      { id: "R2", kind: "ready", quote: { source: "context", ref: "M1", text: "listo" } },
    ] } });
  });

  test("rejects a quote that points to a message outside the context", () => {
    expect(parseIntentAnswer(answer({ requests: [{ kind: "add", quote: { message: "M9", text: "x" } }] }), input).success).toBe(false);
  });

  test("rejects requests with no requests listed, and requests next to a no intent answer", () => {
    expect(parseIntentAnswer(answer({ requests: [] }), input).success).toBe(false);
    expect(parseIntentAnswer(answer({ outcome: "no_intent", noIntentReason: "thanks" }), input).success).toBe(false);
  });

  test("reads no intent with its reason and language in Portuguese", () => {
    const parsed = parseIntentAnswer(answer({ outcome: "no_intent", noIntentReason: "payment_report", language: "pt", requests: [] }), input);

    expect(parsed).toEqual({ success: true, data: { kind: "no_intent", reason: "payment_report", language: "pt", addresses: [] } });
  });

  test("requires a known reason for no intent", () => {
    expect(parseIntentAnswer(answer({ outcome: "no_intent", noIntentReason: null, requests: [] }), input).success).toBe(false);
    expect(parseIntentAnswer(answer({ outcome: "no_intent", noIntentReason: "angry", requests: [] }), input).success).toBe(false);
  });

  test("reads unsure", () => {
    expect(parseIntentAnswer(answer({ outcome: "unsure", requests: [] }), input)).toEqual({ success: true, data: { kind: "unsure", language: "es", addresses: [] } });
  });

  test("keeps address spans of the current message and of unmasked context messages only", () => {
    const parsed = parseIntentAnswer(answer({ addresses: [
      { message: "current", text: "Av. Lima 123" },
      { message: "M1", text: "Jr. Cusco 45" },
      { message: "M2", text: "Calle Sol 9" },
      { message: "M7", text: "Calle Luna 3" },
      { message: "current", text: "" },
    ] }), input);

    expect(parsed).toMatchObject({ success: true, data: { addresses: [{ message: "current", text: "Av. Lima 123" }, { message: "M1", text: "Jr. Cusco 45" }] } });
  });

  test("rejects an unknown language, an extra field and a non-object answer", () => {
    expect(parseIntentAnswer(answer({ language: "en" }), input).success).toBe(false);
    expect(parseIntentAnswer(answer({ extra: 1 }), input).success).toBe(false);
    expect(parseIntentAnswer("requests", input).success).toBe(false);
  });

  test("never carries model text in its failure reason", () => {
    const parsed = parseIntentAnswer(answer({ requests: [{ kind: "SECRET-KIND", quote: { message: "current", text: "x" } }] }), input);

    expect(parsed.success ? "" : parsed.error.message).not.toContain("SECRET-KIND");
  });
});
