import { describe, expect, test } from "vitest";
import { readerJsonSchema, readerSchema, toReaderAnswer } from "@core/src/features/orders/infrastructure/chat-reader-schema";

const price = { amount: "40", currency: "PEN", per: "unit" } as const;
const add = (over: Record<string, unknown> = {}) => ({ kind: "add", product: { kind: "ref", refs: null, ref: "P1" }, attributes: [{ name: "Talla", value: "M" }], quantity: 2, price: null, ...over });
const ready = { kind: "ready" };
const answer = (actions: unknown[], over: Record<string, unknown> = {}) => ({ outcome: "actions", actions, moreActions: false, ...over });

/** Fills the fields the strict schema requires, with null where the action kind does not use them. */
const full = (action: Record<string, unknown>) => ({
  product: null, pendingProduct: null, attributes: null, quantity: null, price: null, pending: null, item: null, amount: null, mode: null, pendings: null, ...action,
});
const parse = (value: unknown) => readerSchema.safeParse(value);

describe("readerSchema", () => {
  test("maps a strict answer with an add and a ready to the reader answer", () => {
    const parsed = parse(answer([full(add({ price })), full(ready)]));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(toReaderAnswer(parsed.data)).toEqual({
      kind: "actions", moreActions: false,
      actions: [
        { kind: "add", product: { kind: "ref", ref: "P1" }, attributes: [{ name: "Talla", value: "M" }], quantity: 2, price },
        { kind: "ready" },
      ],
    });
  });

  test("maps no intent and doubt without actions", () => {
    for (const outcome of ["no_intent", "doubt"] as const) {
      const parsed = parse({ outcome, actions: [], moreActions: false });
      expect(parsed.success && toReaderAnswer(parsed.data)).toEqual({ kind: outcome });
    }
  });

  test("rejects an answer with an unknown action kind or more than thirty actions as invalid", () => {
    expect(parse(answer([full({ kind: "refund" })])).success).toBe(false);
    expect(parse(answer(Array.from({ length: 31 }, () => full(ready)))).success).toBe(false);
    expect(parse(answer(Array.from({ length: 30 }, () => full(ready)))).success).toBe(true);
  });

  test("rejects an actions answer with no actions as invalid", () => {
    expect(parse(answer([])).success).toBe(false);
  });

  test("maps more than ten actions and the more-actions flag to the reader answer", () => {
    const parsed = parse(answer(Array.from({ length: 12 }, () => full(ready)), { moreActions: true }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const mapped = toReaderAnswer(parsed.data);
    expect(mapped && mapped.kind === "actions" && [mapped.actions.length, mapped.moreActions]).toEqual([12, true]);
  });

  test("maps every action kind with its own fields", () => {
    const item = { kind: "ref", ref: "I1" };
    const nullRefItem = (kind: string) => ({ kind, ref: null });
    const cases: [Record<string, unknown>, unknown][] = [
      [{ kind: "complete_pending", pending: "Q1", pendingProduct: "P2", attributes: [{ name: "Color", value: "Negro" }], quantity: 1, price: null },
        { kind: "complete_pending", pending: "Q1", product: "P2", attributes: [{ name: "Color", value: "Negro" }], quantity: 1, price: null }],
      [{ kind: "decline_pending", pending: "Q1" }, { kind: "decline_pending", pending: "Q1" }],
      [{ kind: "decline_shown" }, { kind: "decline_shown" }],
      [{ kind: "remove", item, amount: "one" }, { kind: "remove", item, amount: "one" }],
      [{ kind: "change_quantity", item: nullRefItem("unnamed"), mode: "set", quantity: 3 }, { kind: "change_quantity", target: { kind: "unnamed" }, mode: "set", quantity: 3 }],
      [{ kind: "change_variant", item, attributes: [{ name: "Talla", value: "L" }], price: null }, { kind: "change_variant", item, attributes: [{ name: "Talla", value: "L" }], price: null }],
      [{ kind: "set_price", item: nullRefItem("not_in_order"), price }, { kind: "set_price", item: { kind: "not_in_order" }, price }],
      [{ kind: "variant_only" }, { kind: "variant_only" }],
      [{ kind: "variant_for_pendings", pendings: ["Q1", "Q2"] }, { kind: "variant_for_pendings", pendings: ["Q1", "Q2"] }],
      [{ kind: "not_allowed" }, { kind: "not_allowed" }],
      [add({ product: { kind: "one_of", refs: ["P1", "P2"], ref: null } }), { kind: "add", product: { kind: "one_of", refs: ["P1", "P2"] }, attributes: [{ name: "Talla", value: "M" }], quantity: 2, price: null }],
      [add({ product: { kind: "unnamed", refs: null, ref: null }, attributes: null, quantity: null }), { kind: "add", product: { kind: "unnamed" }, attributes: [], quantity: null, price: null }],
    ];
    for (const [action, expected] of cases) {
      const parsed = parse(answer([full(action)]));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      if (parsed.success) expect(toReaderAnswer(parsed.data)).toEqual({ kind: "actions", moreActions: false, actions: [expected] });
    }
  });

  test("turns an action missing a field its kind needs into a malformed action and keeps the others", () => {
    const wrong = [
      full({ kind: "remove", item: null, amount: "one" }),
      full({ kind: "variant_for_pendings", pendings: ["Q1"] }),
      full({ kind: "add", product: { kind: "one_of", refs: ["P1"], ref: null } }),
      full({ kind: "add", product: { kind: "ref", refs: null, ref: null } }),
      full({ kind: "change_quantity", item: { kind: "unnamed", ref: null }, mode: null, quantity: 1 }),
    ];
    const parsed = parse(answer([...wrong, full(ready)]));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(toReaderAnswer(parsed.data)).toEqual({ kind: "actions", moreActions: false, actions: [...wrong.map(() => ({ kind: "malformed" })), { kind: "ready" }] });
  });

  test("ignores the actions of a no intent or doubt answer", () => {
    const parsed = parse({ outcome: "no_intent", actions: [full({ kind: "remove" })], moreActions: false });
    expect(parsed.success && toReaderAnswer(parsed.data)).toEqual({ kind: "no_intent" });
  });
});

describe("readerJsonSchema", () => {
  test("is a plain root object without a draft marker", () => {
    expect(Object.keys(readerJsonSchema).sort()).toEqual(["additionalProperties", "properties", "required", "type"]);
  });

  test("limits the actions to ten and keeps every strict object closed with all its fields required", () => {
    const root = readerJsonSchema as { properties: { actions: { maxItems: number } } };
    expect(root.properties.actions.maxItems).toBe(10);
    const open: string[] = [];
    const visit = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((child, index) => visit(child, `${path}[${index}]`));
      if (typeof node !== "object" || node === null) return;
      const object = node as { type?: unknown; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown };
      if (object.type === "object") {
        if (object.additionalProperties !== false) open.push(`${path}: additionalProperties`);
        if (JSON.stringify([...(object.required ?? [])].sort()) !== JSON.stringify(Object.keys(object.properties ?? {}).sort())) open.push(`${path}: required`);
      }
      for (const [key, child] of Object.entries(node)) visit(child, `${path}.${key}`);
    };
    visit(readerJsonSchema, "$");
    expect(open).toEqual([]);
    expect(JSON.stringify(readerJsonSchema)).not.toMatch(/oneOf|\$ref|\$schema|"const"/);
  });
});
