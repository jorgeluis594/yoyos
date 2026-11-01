import { describe, expect, test } from "vitest";
import { dedupeIntents, droppedFields, verifyIntentQuotes, verifyQuotes } from "@core/src/features/orders/domain/reader/quotes";
import type { ContextMessageRef, ExtractedRequest, Quote, ReadingInput, RequestIntent, RequestRef } from "@core/src/features/orders/domain/reader/readings";

const ref = (value: string) => value as RequestRef;
const current = (text: string): Quote => ({ source: "current", text });
const input = (text: string, context: ReadingInput["context"] = []): ReadingInput => ({ current: { messageId: "m1" as never, kind: "text", text }, context, items: [], pendings: [], photoMemory: null, photo: null });
const request = (over: Partial<ExtractedRequest> = {}): ExtractedRequest =>
  ({ request: ref("R1"), kind: "add", target: { kind: "named", words: current("el polo") }, values: [], quantity: null, price: null, changeVerb: null, ...over });
const only = (requests: ReturnType<typeof verifyQuotes>) => requests[0]!;

describe("verifyQuotes", () => {
  test("drops an extracted quantity whose quote is not in the current message", () => {
    const checked = only(verifyQuotes([request({ quantity: { value: 3, mode: "set", quote: current("tres") } })], input("quiero el polo")));
    expect(checked.request.quantity).toBeNull();
    expect(checked.complete).toBe(false);
  });

  test("accepts a quote that differs from the message only in case and spacing", () => {
    const checked = only(verifyQuotes([request({ quantity: { value: 3, mode: "set", quote: current("DAME   dos") } })], input("hola, dame dos del polo")));
    expect(checked.request.quantity?.value).toBe(3);
    expect(checked.complete).toBe(true);
  });

  test("refuses a context quote as justification for a variant value", () => {
    const context = [{ ref: "M1" as ContextMessageRef, direction: "outgoing", kind: "text", text: "¿En qué talla?", sentAt: new Date(), masked: false } as const];
    const values = [{ attributeWords: null, valueWords: { source: "context", ref: "M1" as ContextMessageRef, text: "talla" } as Quote }];
    const checked = only(verifyQuotes([request({ values })], input("en M", context)));
    expect(checked.request.values).toEqual([]);
    expect(checked.complete).toBe(false);
  });

  test("keeps a context quote that justifies a target when the context message holds it", () => {
    const context = [{ ref: "M1" as ContextMessageRef, direction: "incoming", kind: "text", text: "me gusta la gorra trucker", sentAt: new Date(), masked: false } as const];
    const target = { kind: "named", words: { source: "context", ref: "M1" as ContextMessageRef, text: "la gorra trucker" } } as const;
    expect(only(verifyQuotes([request({ target })], input("dame uno más", context))).request.target).toEqual(target);
    const wrong = { kind: "named", words: { source: "context", ref: "M1" as ContextMessageRef, text: "la casaca" } } as const;
    expect(only(verifyQuotes([request({ target: wrong })], input("dame uno más", context))).request.target).toEqual({ kind: "none" });
  });

  test("makes a target taken from an item context when its naming words are not found", () => {
    const target = { kind: "item", ref: "I1", named: current("el polo") } as ExtractedRequest["target"];
    const checked = only(verifyQuotes([request({ target })], input("quítalo")));
    expect(checked.request.target).toEqual({ kind: "item", ref: "I1", named: null });
    expect(checked.complete).toBe(false);
  });

  test("drops a price and a change verb whose quotes are not found and keeps the rest", () => {
    const price = { amount: 55, currency: "order", basis: "unit", quote: current("a 55") } as const;
    const checked = only(verifyQuotes([request({ price, changeVerb: current("cámbialo"), quantity: { value: 2, mode: "add", quote: current("dos") } })], input("quiero dos polos")));
    expect(checked.request.price).toBeNull();
    expect(checked.request.changeVerb).toBeNull();
    expect(checked.request.quantity?.value).toBe(2);
  });

  test("keeps a request whose every quote is found complete", () => {
    expect(only(verifyQuotes([request()], input("quiero el polo"))).complete).toBe(true);
  });
});

describe("line breaks rendered as ⏎", () => {
  test("accepts a quote the model copied with ⏎ where the message has a line break", () => {
    const checked = only(verifyQuotes([request({ quantity: { value: 2, mode: "set", quote: current("dame dos⏎del polo") } })], input("hola\ndame dos\ndel polo")));
    expect(checked.request.quantity?.value).toBe(2);
    expect(checked.complete).toBe(true);
  });
});

describe("verifyIntentQuotes", () => {
  const intent = (id: string, quote: Quote) => ({ id: ref(id), kind: "add" as const, quote });

  test("keeps the intents whose quote is in the message and reports the dropped ones", () => {
    const verified = verifyIntentQuotes([intent("R1", current("dame dos")), intent("R2", current("una casaca"))], input("hola, dame dos del polo"));
    expect(verified.kept.map(({ id }) => id)).toEqual(["R1"]);
    expect(verified.dropped.map(({ id }) => id)).toEqual(["R2"]);
  });

  test("verifies a context quote against its context message and ignores ⏎", () => {
    const context = [{ ref: "M1" as ContextMessageRef, direction: "incoming", kind: "text", text: "la gorra\ntrucker", sentAt: new Date(), masked: false } as const];
    const quote: Quote = { source: "context", ref: "M1" as ContextMessageRef, text: "la gorra⏎trucker" };
    expect(verifyIntentQuotes([intent("R1", quote)], input("dame uno", context)).kept).toHaveLength(1);
    expect(verifyIntentQuotes([intent("R1", { ...quote, ref: "M9" as ContextMessageRef })], input("dame uno", context)).kept).toHaveLength(0);
  });
});


describe("droppedFields", () => {
  test("names the fields whose quote verification dropped", () => {
    const before = request({ quantity: { value: 3, mode: "set", quote: current("tres") }, values: [{ attributeWords: null, valueWords: current("rojo") }], changeVerb: current("cambia") });
    const after = only(verifyQuotes([before], input("quiero el polo"))).request;

    expect(droppedFields(before, after)).toEqual(["values", "quantity", "change_verb"]);
  });

  test("names nothing when every quote is found", () => {
    const before = request();
    expect(droppedFields(before, only(verifyQuotes([before], input("dame el polo"))).request)).toEqual([]);
  });
});

describe("dedupeIntents", () => {
  const intent = (id: string, kind: RequestIntent["kind"], text: string): RequestIntent => ({ id: ref(id), kind, quote: current(text) });

  test("keeps one intent of the same kind and quote when the message says the words once", () => {
    const kept = dedupeIntents([intent("R1", "add", "uno más igual"), intent("R2", "add", "Uno  más igual")], input("uno más igual x fa"));
    expect(kept.map(({ id }) => id)).toEqual(["R1"]);
  });

  test("keeps as many as the message says the words and every intent of another kind or quote", () => {
    const text = "2 gorras y 2 gorras, quita el polo";
    const kept = dedupeIntents([intent("R1", "add", "2 gorras"), intent("R2", "add", "2 gorras"), intent("R3", "add", "2 gorras"), intent("R4", "remove", "2 gorras"), intent("R5", "remove", "quita el polo")], input(text));
    expect(kept.map(({ id }) => id)).toEqual(["R1", "R2", "R4", "R5"]);
  });
});
