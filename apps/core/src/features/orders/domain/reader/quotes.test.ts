import { describe, expect, test } from "vitest";
import { dedupeRequests, droppedFields, verifyIntentQuotes, verifyQuotes } from "@core/src/features/orders/domain/reader/quotes";
import type { ContextMessageRef, ExtractedRequest, Quote, ReadingInput, RequestRef } from "@core/src/features/orders/domain/reader/readings";

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

  test("keeps a value whose attribute words the buyer did not write, without the attribute words", () => {
    const values = [{ attributeWords: current("color"), valueWords: current("negro") }, { attributeWords: current("talla"), valueWords: current("M") }];
    const checked = only(verifyQuotes([request({ values })], input("el polo negro en talla M")));
    expect(checked.request.values).toEqual([{ attributeWords: null, valueWords: current("negro") }, { attributeWords: current("talla"), valueWords: current("M") }]);
    expect(checked.complete).toBe(true);
  });

  test("still drops a value whose own words are not in the message", () => {
    const checked = only(verifyQuotes([request({ values: [{ attributeWords: current("color"), valueWords: current("verde") }] })], input("el polo negro")));
    expect(checked.request.values).toEqual([]);
    expect(checked.complete).toBe(false);
  });

  test("drops a value that lies only inside the price quote, the quantity quote or the target's name", () => {
    const price = { amount: 35, currency: "order", basis: "unit", quote: current("35 soles") } as const;
    const priced = only(verifyQuotes([request({ price, values: [{ attributeWords: null, valueWords: current("35") }] })], input("lo quiero a 35 soles")));
    expect(priced.request.values).toEqual([]);
    const target = { kind: "named", words: current("el de rayas") } as const;
    expect(only(verifyQuotes([request({ target, values: [{ attributeWords: null, valueWords: current("rayas") }] })], input("dame el de rayas"))).request.values).toEqual([]);
    const quantity = { value: 2, mode: "add", quote: current("2 polos") } as const;
    expect(only(verifyQuotes([request({ quantity, values: [{ attributeWords: null, valueWords: current("2") }] })], input("quiero 2 polos"))).request.values).toEqual([]);
  });

  test("keeps a value inside the words that point at an order line or a pending, also when both quotes have the same span", () => {
    const values = [{ attributeWords: null, valueWords: current("la de talla M") }];
    for (const target of [{ kind: "item", ref: "I1", named: current("la de talla M") }, { kind: "pending", ref: "Q1", named: current("la de talla M") }] as const) {
      expect(only(verifyQuotes([request({ target, values })], input("cambia la de talla M"))).request.values).toEqual(values);
    }
    const inner = [{ attributeWords: null, valueWords: current("talla M") }];
    const item = { kind: "item", ref: "I1", named: current("la de talla M") } as const;
    expect(only(verifyQuotes([request({ target: item, values: inner })], input("cambia la de talla M"))).request.values).toEqual(inner);
    const named = { kind: "named", words: current("la de talla M") } as const;
    expect(only(verifyQuotes([request({ target: named, values })], input("dame la de talla M"))).request.values).toEqual([]);
  });

  test("keeps a value that also appears outside the words of the other datum", () => {
    const quantity = { value: 2, mode: "add", quote: current("2 polos") } as const;
    const values = [{ attributeWords: null, valueWords: current("l") }];
    expect(only(verifyQuotes([request({ quantity, values })], input("quiero 2 polos talla L"))).request.values).toEqual(values);
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

describe("dedupeRequests", () => {
  const said = (id: string, over: Partial<ExtractedRequest> = {}) => ({ request: request({ request: ref(id), ...over }), complete: true });
  const twoGorras = { quantity: { value: 2, mode: "add" as const, quote: current("2 gorras") } };

  test("keeps one request of the same extracted signature when the message says the words once, and reports the other as absorbed", () => {
    const { kept, absorbed } = dedupeRequests([said("R1", twoGorras), said("R2", twoGorras)], input("2 gorras x fa"));
    expect(kept.map(({ request: entry }) => entry.request)).toEqual(["R1"]);
    expect(absorbed).toEqual(["R2"]);
  });

  test("keeps as many as the message says the words", () => {
    const { kept, absorbed } = dedupeRequests([said("R1", twoGorras), said("R2", twoGorras), said("R3", twoGorras)], input("2 gorras y 2 gorras"));
    expect(kept.map(({ request: entry }) => entry.request)).toEqual(["R1", "R2"]);
    expect(absorbed).toEqual(["R3"]);
  });

  test("never drops a request that extracted something else from the same words", () => {
    const polo = { target: { kind: "named" as const, words: current("polo") } };
    const gorra = { target: { kind: "named" as const, words: current("gorra") } };
    const each = { quantity: { value: 2, mode: "add" as const, quote: current("dos de cada una") } };
    const { kept, absorbed } = dedupeRequests([said("R1", { ...polo, ...each }), said("R2", { ...gorra, ...each })], input("polo y gorra, dos de cada una"));
    expect(kept).toHaveLength(2);
    expect(absorbed).toEqual([]);
  });
});
