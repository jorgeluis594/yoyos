import { describe, expect, test } from "vitest";
import { isPhotoCase, messageExpectation, noticeKind, outcomeKinds, parseCases, type EvalCaseInput } from "@core/evals/cases/schema";
import { sellerNoticeKinds } from "@core/src/features/orders/domain/seller-notice";

test("parses every new outcome kind in an expectation", () => {
  const added = ["pending_created", "pending_updated", "pending_completed", "pending_split", "pending_ended", "reader_doubt", "request_not_allowed", "invalid_action",
    "product_not_available", "variant_for_several_pendings", "ready_with_pendings", "caption_not_applied"] as const;

  for (const kind of added) expect(messageExpectation.parse({ notice: null, outcomes: [kind] }).outcomes).toEqual([kind]);
  expect(outcomeKinds).toEqual(expect.arrayContaining([...added]));
  expect(() => messageExpectation.parse({ notice: null, outcomes: ["nonsense"] })).toThrow();
});

test("uses only seller notice kinds that exist in an expectation", () => {
  for (const kind of sellerNoticeKinds) expect(messageExpectation.parse({ notice: kind }).notice).toBe(kind);
  expect(noticeKind.options).toEqual(sellerNoticeKinds);
  expect(() => messageExpectation.parse({ notice: "made_up" })).toThrow();
  expect(() => messageExpectation.parse({})).toThrow("states a notice or outcomes");
});

describe("starting state", () => {
  const line = { product: "polo-basico", variant: { Talla: "M", Color: "Negro" }, quantity: 2 };
  const message = (input: object): EvalCaseInput => ({ id: "start-a", pass: "interpretation", criterion: 1, kind: "start", input: { text: "hola", ...input }, expected: [{ notice: null }] } as EvalCaseInput);
  const conversation = (start: object): EvalCaseInput => ({ id: "start-c", pass: "conversation", kind: "start", ...start, steps: [
    { input: { text: "uno" }, expected: { notice: null } }, { input: { text: "dos" }, expected: { notice: null } }] } as EvalCaseInput);

  test("leaves a case without a start valid, with an empty order and no pendings", () => {
    const [parsed] = parseCases([message({})]);

    expect(parsed.pass === "interpretation" && parsed.input).toMatchObject({ order: [], pendings: [] });
    expect(parsed.pass === "interpretation" && parsed.input.orderState).toBeUndefined();
  });

  test("parses a conversation start with order, pendings and a closed order", () => {
    const [parsed] = parseCases([conversation({ order: [line], pendings: [{ product: "polo-premium", known: { Talla: "M" }, quantity: 3 }, { candidates: ["gorra-trucker", "gorra-snapback"] }], orderState: "closed" })]);

    expect(parsed).toMatchObject({ order: [line], orderState: "closed", pendings: [{ product: "polo-premium", known: { Talla: "M" }, quantity: 3 }, { candidates: ["gorra-trucker", "gorra-snapback"], known: {}, quantity: 1 }] });
  });

  test("rejects a closed order without lines and an orderState other than closed", () => {
    expect(() => parseCases([message({ orderState: "closed" })])).toThrow("A closed order needs order lines");
    expect(() => parseCases([conversation({ orderState: "closed" })])).toThrow("A closed order needs order lines");
    expect(() => parseCases([message({ order: [line], orderState: "open" })])).toThrow();
  });

  test("rejects malformed pendings: no subject, both subjects, one or five candidates, a zero quantity, more than ten, unknown fields", () => {
    const bad = (pending: object) => () => parseCases([message({ pendings: [pending] })]);

    expect(bad({ known: {} })).toThrow();
    expect(bad({ product: "polo-basico", candidates: ["polo-premium", "polo-rayas"] })).toThrow();
    expect(bad({ candidates: ["polo-premium"] })).toThrow();
    expect(bad({ candidates: ["polo-basico", "polo-premium", "polo-rayas", "polo-oversize", "gorra-trucker"] })).toThrow();
    expect(bad({ product: "polo-basico", quantity: 0 })).toThrow();
    expect(bad({ product: "polo-basico", price: 10 })).toThrow();
    expect(() => parseCases([message({ pendings: Array.from({ length: 11 }, () => ({ product: "polo-basico" })) })])).toThrow();
  });

  test("checks the seeded products and variants against the catalog", () => {
    expect(() => parseCases([message({ order: [{ ...line, product: "no-existe" }] })])).toThrow("outside the catalog");
    expect(() => parseCases([message({ pendings: [{ product: "no-existe" }] })])).toThrow("outside the catalog");
    expect(() => parseCases([conversation({ order: [{ ...line, product: "no-existe" }] })])).toThrow("outside the catalog");
    expect(() => parseCases([message({ order: [{ ...line, variant: { Talla: "XXL", Color: "Negro" } }] })])).toThrow("matches no catalog variant");
    expect(() => parseCases([conversation({ order: [{ ...line, variant: { Talla: "M" } }] })])).toThrow("matches no catalog variant");
    expect(parseCases([message({ order: [{ ...line, variant: { Color: "Negro", Talla: "M" } }] })])).toHaveLength(1);
  });

  test("a product pending needs known values that belong to a variant still incomplete; a doubtful one needs distinct candidates whose values exist", () => {
    const pending = (value: object) => () => parseCases([message({ pendings: [value] })]);

    expect(pending({ product: "polo-basico", known: { Talla: "M" } })).not.toThrow();
    expect(pending({ product: "polo-basico" })).not.toThrow();
    expect(pending({ product: "polo-basico", known: { Talla: "XXL" } })).toThrow("not part of one incomplete variant");
    expect(pending({ product: "polo-basico", known: { Talla: "M", Color: "Negro" } })).toThrow("not part of one incomplete variant");
    expect(pending({ product: "gorra-snapback", known: { Color: "Azul" } })).toThrow("not part of one incomplete variant");
    expect(pending({ candidates: ["polo-basico", "polo-premium"], known: { Color: "Negro" } })).not.toThrow();
    expect(pending({ candidates: ["polo-basico", "polo-basico"] })).toThrow("same candidate twice");
    expect(pending({ candidates: ["polo-basico", "polo-premium"], known: { Talla: "XXL" } })).toThrow("a candidate lacks");
    expect(pending({ candidates: ["polo-basico", "gorra-trucker"], known: { Talla: "M" } })).toThrow("a candidate lacks");
  });
});

describe("photo cases", () => {
  const message = (photo?: { shows: string }) => ({ input: photo ? { photo } : { text: "dos" }, expected: { notice: null } });
  const conversation = (...steps: ReturnType<typeof message>[]) => ({ id: "c", pass: "conversation", kind: "k", steps }) as unknown as Parameters<typeof isPhotoCase>[0];

  test("a conversation with a photo in any step marks every one of its records as a photo case", () => {
    expect(isPhotoCase(conversation(message({ shows: "not_found" }), message()))).toBe(true);
    expect(isPhotoCase(conversation(message(), message(), message({ shows: "not_product" })))).toBe(true);
    expect(isPhotoCase(conversation(message(), message()))).toBe(false);
  });

  test("a message case is a photo case only when it has a photo", () => {
    const single = (input: object) => ({ id: "m", pass: "interpretation", criterion: 1, kind: "k", input, expected: [{ notice: null }] }) as unknown as Parameters<typeof isPhotoCase>[0];
    expect(isPhotoCase(single({ photo: { shows: "not_found" } }))).toBe(true);
    expect(isPhotoCase(single({ text: "uno" }))).toBe(false);
  });
});
