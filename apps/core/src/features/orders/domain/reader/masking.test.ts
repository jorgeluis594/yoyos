import { describe, expect, test } from "vitest";
import { maskPersonalData, maskStageOutput, storedStageOutputSchema } from "@core/src/features/orders/domain/reader/masking";
import type { AddressSpan, ContextMessageRef, ExtractedRequest, IntentReading, ProductResolution, Quote, RequestRef } from "@core/src/features/orders/domain/reader/readings";
import type { ProductId } from "@core/src/features/products/domain/product";

const request = (value: string) => value as RequestRef;
const context = (value: string) => value as ContextMessageRef;
const current = (text: string): Quote => ({ source: "current", text });
const fromContext = (ref: string, text: string): Quote => ({ source: "context", ref: context(ref), text });
const address = (message: AddressSpan["message"], text: string): AddressSpan => ({ message, text });

describe("maskPersonalData", () => {
  test("masks a phone keeping its first three and last two digits", () => {
    expect(maskPersonalData("llámame al +51 987 654 312", [])).toBe("llámame al +51 9•• ••• •12");
    expect(maskPersonalData("es el 987654312 gracias", [])).toBe("es el 987••••12 gracias");
    expect(maskPersonalData("(01) 555-1234 o 999.888.777", [])).toBe("(01) 5••-••34 o 999.•••.•77");
  });

  test("keeps short digit runs, quantities and prices", () => {
    expect(maskPersonalData("2 polos a 35.50 y 3 gorras, talla 38", [])).toBe("2 polos a 35.50 y 3 gorras, talla 38");
    expect(maskPersonalData("123456", [])).toBe("123456");
  });

  test("masks every reported address span of the current and unmasked context messages", () => {
    expect(maskPersonalData("envíalo a Av. Larco 345, Miraflores. Sí, Av. Larco 345", ["Av. Larco 345, Miraflores", "Av. Larco 345"]))
      .toBe("envíalo a [dirección]. Sí, [dirección]");
  });

  test("ignores a reported address span that is not in its message", () => {
    expect(maskPersonalData("quiero dos polos", ["Jr. Unión 12"])).toBe("quiero dos polos");
    expect(maskPersonalData("quiero dos polos", [""])).toBe("quiero dos polos");
  });

  test("masks the same text the same way twice", () => {
    const once = maskPersonalData("al +51 987 654 312, Av. Larco 345", ["Av. Larco 345"]);
    expect(maskPersonalData(once, ["Av. Larco 345"])).toBe(once);
  });
});

describe("maskStageOutput", () => {
  const intent: IntentReading = { kind: "requests", language: "es",
    requests: [{ id: request("R1"), kind: "add", quote: current("dos polos, mi cel 987654312") }, { id: request("R2"), kind: "remove", quote: fromContext("M1", "quita la gorra de Jr. Unión 12") }],
    addresses: [address("current", "Av. Larco 345"), address("current", "Av. Larco 345 Miraflores"), address(context("M1"), "Jr. Unión 12")] };

  test("replaces the intent addresses by their count per message and masks its quotes", () => {
    const stored = maskStageOutput("intent", intent, intent.addresses);
    expect(stored).toEqual({ stage: "intent", kind: "requests", language: "es", addressSpans: [{ message: "current", count: 2 }, { message: "M1", count: 1 }],
      requests: [{ id: "R1", kind: "add", quote: { source: "current", text: "dos polos, mi cel 987••••12" } },
        { id: "R2", kind: "remove", quote: { source: "context", ref: "M1", text: "quita la gorra de [dirección]" } }] });
    expect(JSON.stringify(stored)).not.toContain("Larco");
    expect(storedStageOutputSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  test("stores no reported address span in the trace's stage outputs, quotes or texts", () => {
    const reading: IntentReading = { kind: "unsure", language: "pt", addresses: [address("current", "Rua das Flores 99")] };
    expect(maskStageOutput("intent", reading, reading.addresses)).toEqual({ stage: "intent", kind: "unsure", language: "pt", addressSpans: [{ message: "current", count: 1 }] });
    const noIntent: IntentReading = { kind: "no_intent", reason: "greeting", language: "es", addresses: [] };
    expect(maskStageOutput("intent", noIntent, [])).toEqual({ stage: "intent", kind: "no_intent", reason: "greeting", language: "es", addressSpans: [] });

    const extraction: readonly ExtractedRequest[] = [{ request: request("R1"), kind: "add", target: { kind: "named", words: current("polo de Rua das Flores 99") },
      values: [{ attributeWords: current("talla"), valueWords: fromContext("M2", "M, tel 987 654 312") }],
      quantity: { value: 2, mode: "add", quote: current("dos") }, price: null, changeVerb: null }];
    const stored = JSON.stringify(maskStageOutput("extraction", extraction, [address("current", "Rua das Flores 99")]));
    expect(stored).not.toContain("Flores");
    expect(stored).not.toContain("654");
    expect(stored).toContain("[dirección]");
  });

  test("masks the words and values of a resolution and keeps its ids", () => {
    const chosen: ProductResolution = { request: request("R1"), kind: "chosen", productId: "p-1" as ProductId,
      values: [{ attribute: "Talla", value: "M", quote: current("la M, cel 987654312") }] };
    const between: ProductResolution = { request: request("R2"), kind: "between", productIds: ["p-1" as ProductId, "p-2" as ProductId] };
    const stored = maskStageOutput("resolution", [chosen, between, { request: request("R3"), kind: "none" }], []);
    expect(stored).toEqual({ stage: "resolution", resolutions: [
      { request: "R1", kind: "chosen", productId: "p-1", values: [{ attribute: "Talla", value: "M", quote: { source: "current", text: "la M, cel 987••••12" } }] },
      between, { request: "R3", kind: "none" }] });
  });

  test("the stored output schema rejects an unmasked address list and unknown fields", () => {
    expect(storedStageOutputSchema.safeParse({ stage: "intent", kind: "unsure", language: "es", addresses: [{ message: "current", text: "Av. Larco 345" }] }).success).toBe(false);
    expect(storedStageOutputSchema.safeParse({ stage: "intent", kind: "unsure", language: "es", addressSpans: [], prompt: "x" }).success).toBe(false);
    expect(storedStageOutputSchema.safeParse({ stage: "memory", kind: "unsure" }).success).toBe(false);
  });
});
