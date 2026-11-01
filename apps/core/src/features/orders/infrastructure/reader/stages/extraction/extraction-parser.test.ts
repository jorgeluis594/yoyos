import { describe, expect, test } from "vitest";
import { answerEntry, contextMessage, currentQuote, extractionInput, intent, item, pending, readingInput } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-test-support";
import { parseExtractionAnswer } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-parser";

const quote = (text: string, message = "current") => ({ message, text });
const input = extractionInput(
  readingInput({ current: { messageId: "m" as never, kind: "text", text: "quiero 2 polos negros a 30 soles, cámbialo a M" }, context: [contextMessage(1), contextMessage(2)], items: [item(1)], pendings: [pending(1)] }),
  [intent(1, "add", "quiero 2 polos negros"), intent(2, "change_variant", "cámbialo a M")],
);
const answer = (...requests: unknown[]) => ({ requests });

describe("extraction parser", () => {
  test("parses every field of a request into an ExtractedRequest, taking the kind from the intent", () => {
    const parsed = parseExtractionAnswer(answer(
      answerEntry("R1", {
        target: { kind: "named", ref: null, named: quote("polos"), basis: null },
        values: [{ attribute: null, value: quote("negros") }],
        quantity: { value: 2, mode: "add", quote: quote("2") },
        price: { amount: 30, currency: "other", basis: "not_explicit", quote: quote("30 soles") },
      }),
      answerEntry("R2", { target: { kind: "item", ref: "I1", named: null, basis: null }, values: [{ attribute: quote("a"), value: quote("M") }], changeVerb: quote("cámbialo") }),
    ), input);

    expect(parsed).toEqual({ success: true, data: [
      { request: "R1", kind: "add", target: { kind: "named", words: currentQuote("polos") }, values: [{ attributeWords: null, valueWords: currentQuote("negros") }],
        quantity: { value: 2, mode: "add", quote: currentQuote("2") }, price: { amount: 30, currency: "other", basis: "not_explicit", quote: currentQuote("30 soles") }, changeVerb: null },
      { request: "R2", kind: "change_variant", target: { kind: "item", ref: "I1", named: null }, values: [{ attributeWords: currentQuote("a"), valueWords: currentQuote("M") }],
        quantity: null, price: null, changeVerb: currentQuote("cámbialo") },
    ] });
  });

  test("keeps a quote that is not in the message: dropping it is verifyQuotes' job", () => {
    const parsed = parseExtractionAnswer(answer(
      answerEntry("R1", { quantity: { value: 7, mode: "set", quote: quote("siete unidades") }, values: [{ attribute: null, value: quote("rosado") }] }),
      answerEntry("R2"),
    ), input);

    expect(parsed).toMatchObject({ success: true, data: [{ quantity: { value: 7, quote: { text: "siete unidades" } }, values: [{ valueWords: { text: "rosado" } }] }, {}] });
  });

  test("reads a quote of a recent message as a context quote and refuses one of a message that is not listed", () => {
    const named = (message: string) => answer(answerEntry("R1", { target: { kind: "named", ref: null, named: quote("la mochila", message), basis: null } }), answerEntry("R2"));

    expect(parseExtractionAnswer(named("M2"), input)).toMatchObject({ success: true, data: [{ target: { kind: "named", words: { source: "context", ref: "M2", text: "la mochila" } } }, {}] });
    expect(parseExtractionAnswer(named("M9"), input).success).toBe(false);
    expect(parseExtractionAnswer(named("el chat"), input).success).toBe(false);
  });

  test.each([
    ["a quantity written as text", { quantity: { value: "dos", mode: "add", quote: quote("2") } }],
    ["a quantity that is not finite or positive", { quantity: { value: 0, mode: "add", quote: quote("2") } }],
    ["a price written as text", { price: { amount: "30", currency: "order", basis: "unit", quote: quote("30") } }],
    ["an unknown quantity mode", { quantity: { value: 2, mode: "increase", quote: quote("2") } }],
  ])("rejects %s", (_name, over) => {
    expect(parseExtractionAnswer(answer(answerEntry("R1", over), answerEntry("R2")), input)).toMatchObject({ success: false });
  });

  test.each([
    ["a named target without words", { kind: "named", ref: null, named: null, basis: null }],
    ["an item reference that is not listed", { kind: "item", ref: "I7", named: null, basis: null }],
    ["a pending reference that is not listed", { kind: "pending", ref: "Q3", named: null, basis: null }],
    ["an item target without a reference", { kind: "item", ref: null, named: null, basis: null }],
    ["a context target without a basis", { kind: "context", ref: "M1", named: null, basis: null }],
    ["a context target on the only item with a message reference", { kind: "context", ref: "M1", named: null, basis: "only_item" }],
    ["a context target on a photo with an item reference", { kind: "context", ref: "I1", named: null, basis: "last_photo" }],
  ])("rejects %s", (_name, target) => {
    expect(parseExtractionAnswer(answer(answerEntry("R1", { target }), answerEntry("R2")), input).success).toBe(false);
  });

  test("accepts a context target on the only item and on the last photo", () => {
    const parsed = parseExtractionAnswer(answer(
      answerEntry("R1", { target: { kind: "context", ref: "I1", named: null, basis: "only_item" } }),
      answerEntry("R2", { target: { kind: "context", ref: "M1", named: null, basis: "last_photo" } }),
    ), input);

    expect(parsed).toMatchObject({ success: true, data: [{ target: { kind: "context", basis: "only_item", ref: "I1" } }, { target: { kind: "context", basis: "last_photo", ref: "M1" } }] });
  });

  test("accepts the targets that need no reference", () => {
    for (const kind of ["photo_same_message", "photo_just_sent", "none"]) {
      const parsed = parseExtractionAnswer(answer(answerEntry("R1", { target: { kind, ref: null, named: null, basis: null } }), answerEntry("R2")), input);
      expect(parsed).toMatchObject({ success: true, data: [{ target: { kind } }, {}] });
    }
  });

  test("rejects an answer that omits a request, repeats one or names one the intent did not list", () => {
    expect(parseExtractionAnswer(answer(answerEntry("R1")), input).success).toBe(false);
    expect(parseExtractionAnswer(answer(answerEntry("R1"), answerEntry("R1")), input).success).toBe(false);
    expect(parseExtractionAnswer(answer(answerEntry("R1"), answerEntry("R2"), answerEntry("R3")), input).success).toBe(false);
  });

  test("gives the requests in the order of the intents", () => {
    expect(parseExtractionAnswer(answer(answerEntry("R2"), answerEntry("R1")), input)).toMatchObject({ success: true, data: [{ request: "R1" }, { request: "R2" }] });
  });

  test("rejects an answer of another shape, with a reason that carries none of the model's text", () => {
    for (const bad of [null, "texto", { requests: "R1" }, { requests: [answerEntry("R1", { extra: "campo" })] }]) {
      const parsed = parseExtractionAnswer(bad, input);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.message).not.toContain("campo");
    }
  });
});
