import { describe, expect, test } from "vitest";
import type { ChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ReaderAction } from "@core/src/features/orders/domain/chat-reading";
import { createChat, doubtfulPendingOf, id, pendingOf, productId, reader, stated, t0, type Chat } from "@core/src/features/orders/domain/chat-reading-fixtures";
import type { ConfirmedPayment, VoidedPayment } from "@core/src/features/orders/domain/payment";
import type { OrderId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

/** The acceptance criteria of the product draft, as domain scenarios with fixed reader answers. */
const { add, complete, say } = reader;
const DAY = 24 * 3600_000;
const M_NEGRO = { Talla: "M", Color: "Negro" } as const;
const ref = (n: number) => ({ kind: "ref", ref: `I${n}` }) as const;
const noticesOf = (kinds: readonly string[]) => kinds.filter((kind) => !kind.startsWith("pending_") && kind !== "added" && kind !== "removed");
const countKind = (all: readonly ChatMessageOutcome[], kind: string) => all.filter((outcome) => outcome.kind === kind).length;
const confirmed = (order: OrderAggregate, at: Date): ConfirmedPayment => ({ id: id(60) as PaymentId, orderId: order.id, status: "confirmed", amount: { amount: 4, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false,
  data: { confirmedAt: at, confirmedBy: { kind: "seller", userId: "seller" as UserId }, evidence: { kind: "buyer_report", report: { receiptImageId: id(70) as never, reportedAt: at } } } });
const voidedAt = (payment: ConfirmedPayment, at: Date): VoidedPayment => ({ ...payment, status: "voided", data: { ...payment.data, voidedAt: at, voidedBy: "seller" as UserId } });
const pay = (chat: Chat, at: Date) => chat.mutate((order) => ({ ...order, payments: [...order.payments, confirmed(order, at)] }));
const voidPayment = (chat: Chat, at: Date) => chat.mutate((order) => ({ ...order, payments: order.payments.map((payment) => (payment.status === "confirmed" ? voidedAt(payment, at) : payment)) }));
const attached = (orderId = id(1)) => ({ orderId: orderId as OrderId, attachedAt: t0 });

describe("criteria 1–7: building an order from messages", () => {
  test("1. photo without size, then «en talla M», then «negro» creates the order with one item and one notice", () => {
    const chat = createChat();
    const photo = { shown: [["polo"]] } as const;
    expect(chat.say(say(add({ product: "polo" })), photo).kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.order).toBeNull();
    expect(chat.say(say(complete(1, { Talla: "M" }))).kinds).toEqual(["pending_updated"]);
    expect(chat.order).toBeNull();
    expect(chat.say(say(complete(1, { Color: "Negro" }))).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
    expect(chat.order?.items[0]?.unitPrice).toEqual({ amount: 35, currency: "PEN" });
  });

  test("2. photo of a polo with one color without caption, then «en talla M»: one notice in the whole conversation", () => {
    const chat = createChat();
    const first = chat.say(say(add({ product: "oversize" })), { shown: [["oversize"]] });
    const second = chat.say(say(complete(1, { Talla: "M" })));
    expect(chat.items()).toEqual(["Polo oversize · M · Verde · ×1"]);
    expect(countKind([...first.outcomes, ...second.outcomes], "variant_missing")).toBe(1);
    expect(noticesOf(second.kinds)).toEqual([]);
  });

  test("3. «quiero 2 gorras trucker rojas» adds ×2 with no notice", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" }, quantity: 2 }))).kinds).toEqual(["added"]);
    expect(chat.items()).toEqual(["Gorra trucker · Rojo · ×2"]);
  });

  test.each([
    ["4. «2 en 70» at a catalog price of 35 is for the lot", "polo", M_NEGRO, "not_explicit", 2],
    ["5. «2 en 70» at a catalog price of 75 is per unit", "polera", { Talla: "M" }, "not_explicit", 1],
    ["6. «a 40 c/u» is per unit whatever the catalog price", "polo", M_NEGRO, "unit", 1],
    ["7. a tie is for the lot", "oversize", { Talla: "M" }, "not_explicit", 2],
  ] as const)("%s", (_title, product, attributes, per, units) => {
    const chat = createChat();
    const amount = product === "oversize" ? "60" : per === "unit" ? "40" : "70";
    chat.say(say(add({ product, attributes, quantity: 2, price: stated(amount, per) })));
    expect(chat.order?.items[0]).toMatchObject({ quantity: 2, mentionedPrice: { amount: { amount: Number(amount) }, units } });
  });
});

describe("criteria 8–17: reading rules", () => {
  const withTwoItems = () => createChat({ items: [["polo", M_NEGRO, 1], ["gorra", { Color: "Negro" }, 1]] });

  test("8. «quita la gorra y listo» removes the gorra and reports ready", () => {
    const chat = withTwoItems();
    expect(chat.say(say({ kind: "remove", item: ref(2), amount: "all" }, reader.ready)).kinds).toEqual(["removed", "ready"]);
  });

  test("9. «uno más» adds one, «que sean 3» sets 3, «que sean 5» sets 5 and never 7", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 2]] });
    chat.say(say({ kind: "change_quantity", item: ref(1), mode: "increase", quantity: 1 }));
    chat.say(say({ kind: "change_quantity", item: ref(1), mode: "set", quantity: 3 }));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×3"]);
    chat.say(say({ kind: "change_quantity", item: ref(1), mode: "set", quantity: 5 }));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×5"]);
  });

  test("10. an unnamed add changes nothing, whatever the quantity", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    const unnamed = (quantity: number | null): ReaderAction => ({ kind: "add", product: { kind: "unnamed" }, attributes: [], quantity, price: null });
    for (const quantity of [null, 2]) expect(chat.say(say(unnamed(quantity))).kinds).toEqual(["unnamed_add"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
  });

  test("11. a number inside a product name is not a quantity", () => {
    const chat = createChat();
    chat.say(say(add({ product: "medias" })));
    expect(chat.items()).toEqual(["Medias deportivas pack x3 · ×1"]);
  });

  test("12. a doubtful «quiero el polo» is resolved by «el premium negro L» with no second notice, or by «el oversize» then «L»", () => {
    const chat = createChat();
    expect(chat.say(say(reader.oneOf(["polo", "premium", "oversize"]))).kinds).toEqual(["pending_created", "not_clear"]);
    expect(chat.say(say(complete(1, { Color: "Negro", Talla: "L" }, null, "premium"))).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.items()).toEqual(["Polo premium · L · Negro · ×1"]);
    const other = createChat();
    other.say(say(reader.oneOf(["polo", "premium", "oversize"])));
    expect(other.say(say(complete(1, {}, null, "oversize"))).kinds).toEqual(["pending_updated"]);
    expect(other.items()).toEqual([]);
    other.say(say(complete(1, { Talla: "L" })));
    expect(other.items()).toEqual(["Polo oversize · L · Verde · ×1"]);
  });

  test("13. a variant that does not exist stays pending and «entonces en blanco» completes it", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "polo", attributes: { Talla: "M", Color: "Rojo" } }))).kinds).toEqual(["pending_created", "variant_not_available"]);
    expect(chat.say(say(complete(1, { Color: "Blanco" }))).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.items()).toEqual(["Polo básico · M · Blanco · ×1"]);
  });

  test("14–16. doubt, a request the chat never does, and no purchase intent", () => {
    const chat = withTwoItems();
    expect(chat.say({ kind: "doubt" }).kinds).toEqual(["reader_doubt"]);
    expect(chat.say(say({ kind: "not_allowed" })).kinds).toEqual(["request_not_allowed"]);
    expect(chat.say({ kind: "no_intent" }).kinds).toEqual(["no_intent"]);
    expect(chat.items()).toHaveLength(2);
  });

  test("17. a product outside the ones given, an item not in the order and a quantity that would reach 100", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 98]] });
    const unknown: ReaderAction = { kind: "add", product: { kind: "ref", ref: "P99" }, attributes: [], quantity: null, price: null };
    expect(chat.say(say(unknown)).outcomes).toEqual([{ kind: "invalid_action", orderId: chat.order?.id, reason: "unknown_reference" }]);
    expect(chat.say(say({ kind: "remove", item: ref(9), amount: "all" })).kinds).toEqual(["unclear_item"]);
    expect(chat.say(say(add({ product: "polo", attributes: M_NEGRO, quantity: 2 }))).kinds).toEqual(["quantity_above_limit"]);
  });
});

describe("criteria 18–21 and 41: the life of a pending", () => {
  test("18. a pending of a cancelled order ends and «en M» is variant only", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { order: attached() })] });
    chat.mutate((order) => ({ ...order, cancelled: true, cancelledAt: new Date(t0.getTime() + DAY) }));
    const said = chat.say(say({ kind: "variant_only" }), { after: 2 * DAY });
    expect(said.kinds).toEqual(["pending_ended", "variant_only"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1"]);
  });

  test("19. a pending of an order with a reported payment ends, also after the payment is voided, and never reaches a new order", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { order: attached() })] });
    pay(chat, new Date(t0.getTime() + DAY));
    expect(chat.say(say({ kind: "variant_only" }), { after: 2 * DAY }).kinds).toEqual(["pending_ended", "variant_only"]);
    voidPayment(chat, new Date(t0.getTime() + 3 * DAY));
    expect(chat.say(say({ kind: "variant_only" })).kinds).toEqual(["variant_only"]);
    expect(chat.orders).toHaveLength(1);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1"]);
  });

  test("20. a pending without order expires after 7 days, and a partial completion on day 6 restarts the count", () => {
    const expired = createChat({ pendings: [pendingOf("polo")] });
    expect(expired.say(say({ kind: "variant_only" }), { after: 8 * DAY }).kinds).toEqual(["pending_ended", "variant_only"]);
    const chat = createChat({ pendings: [pendingOf("polo")] });
    expect(chat.say(say(complete(1, { Talla: "M" })), { after: 6 * DAY }).kinds).toEqual(["pending_updated"]);
    expect(chat.say(say(complete(1, { Color: "Negro" })), { after: 6 * DAY }).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
  });

  test("21. a pending of an open order is still completed after 10 days with no notice", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { order: attached() })] });
    expect(chat.say(say(complete(1, M_NEGRO)), { after: 10 * DAY }).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Polo básico · M · Negro · ×1"]);
  });

  test("41. a pending without order joins the order a voided payment reopens, and completes into it 9 days later", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo")] });
    pay(chat, new Date(t0.getTime() + DAY / 24));
    voidPayment(chat, new Date(t0.getTime() + 2 * DAY));
    expect(chat.say(say(complete(1, M_NEGRO)), { after: 11 * DAY }).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.orders).toHaveLength(1);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Polo básico · M · Negro · ×1"]);
  });
});

describe("criteria 22–31: ready, several pendings, photos", () => {
  test("22. «listo» with a pending is remembered; completing it reports ready", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { order: attached() })] });
    expect(chat.say(say(reader.ready)).kinds).toEqual(["ready_with_pendings"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1"]);
    expect(chat.say(say(complete(1, M_NEGRO))).kinds).toEqual(["pending_completed", "added", "ready"]);
  });

  test("23. a photo captioned «eso nomás, listo» sends only the variant-missing notice, then «M negro» reports ready", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    expect(chat.say(say(add({ product: "polo" }), reader.ready), { shown: [["polo"]] }).kinds).toEqual(["pending_created", "variant_missing", "ready_with_pendings"]);
    expect(chat.say(say(complete(1, M_NEGRO))).kinds).toEqual(["pending_completed", "added", "ready"]);
  });

  test("24. «en M» fitting two pendings changes nothing; «los dos en M negro» completes both", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { n: 1 }), pendingOf("polera", { n: 2 })] });
    expect(chat.say(say({ kind: "variant_for_pendings", pendings: ["Q1", "Q2"] })).outcomes).toEqual([
      { kind: "variant_for_several_pendings", productIds: [productId("polo"), productId("polera")], unnamed: 0 }]);
    chat.say(say(complete(1, M_NEGRO), complete(2, { Talla: "M" })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polera con capucha · M · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("25. «ya no el polo, solo la gorra roja» ends the pending and adds the gorra", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    expect(chat.say(say(reader.decline(1), add({ product: "gorra", attributes: { Color: "Rojo" } }))).kinds).toEqual(["pending_ended", "added"]);
    expect(chat.items()).toEqual(["Gorra trucker · Rojo · ×1"]);
  });

  test("26. a second photo of the same polo keeps one pending and sends no second notice", () => {
    const chat = createChat();
    const photo = { shown: [["polo"]] } as const;
    expect(chat.say(say(add({ product: "polo" })), photo).kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.say(say(add({ product: "polo" })), photo).kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings).toHaveLength(1);
  });

  test("27. an eleventh pending ends the first silently", () => {
    const pendings = Array.from({ length: 10 }, (_unused, index) => pendingOf("polo", { n: index + 1, lastChangedAt: new Date(t0.getTime() - (10 - index) * 1000) }));
    const chat = createChat({ pendings });
    const said = chat.say(say(add({ product: "gorra" })), { shown: [["gorra"]] });
    expect(said.kinds).toEqual(["pending_created", "variant_missing", "pending_ended"]);
    expect(said.outcomes[2]).toEqual({ kind: "pending_ended", pendingId: pendings[0]!.id, reason: "limit" });
    expect(chat.pendings.pendings).toHaveLength(10);
    expect(chat.pendings.pendings.some((pending) => pending.id === pendings[0]!.id)).toBe(false);
  });

  test("28. a pending of a deactivated product ends with product not available", () => {
    const chat = createChat({ pendings: [pendingOf("polo")], unsellable: ["polo"] });
    expect(chat.say(say(complete(1, M_NEGRO))).outcomes).toEqual([{ kind: "pending_ended", pendingId: pendingOf("polo").id, reason: "product_not_available" },
      { kind: "product_not_available", productId: productId("polo"), reason: "not_sold" }]);
  });

  test("29. a doubted caption: a pending for a polo with variants, the added product for a single variant", () => {
    const chat = createChat();
    expect(chat.say({ kind: "doubt" }, { shown: [["oversize"]] }).kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.say({ kind: "doubt" }, { shown: [["snapback", { Color: "Azul" }]] }).kinds).toEqual(["added", "caption_not_applied"]);
  });

  test("30. a gorra photo whose caption names the pending polo adds both items with no notice", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    const said = chat.say(say(add({ product: "gorra", attributes: { Color: "Negro" } }), complete(1, { Talla: "M", Color: "Blanco" })), { shown: [["gorra", { Color: "Negro" }]] });
    expect(noticesOf(said.kinds)).toEqual([]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Polo básico · M · Blanco · ×1"]);
  });
});

describe("criteria 32–40: replacing, partial completion, limits, price", () => {
  test("32. «y el polo básico x2» makes the pending ×2 with no notice; «quiero 2 de esos» does not change it", () => {
    const chat = createChat();
    chat.say(say(add({ product: "polo" })), { shown: [["polo"]] });
    expect(chat.say(say(add({ product: "polo", quantity: 2 }))).kinds).toEqual(["pending_updated"]);
    expect(chat.say(say({ kind: "add", product: { kind: "unnamed" }, attributes: [], quantity: 2, price: null })).kinds).toEqual(["unnamed_add"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×2 {}']);
    chat.say(say(complete(1, M_NEGRO)));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×2"]);
  });

  test("33. an item of a deactivated product is removed or changed, and a new add of it is not available", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1], ["polo", M_NEGRO, 1]], unsellable: ["gorra"] });
    expect(chat.say(say({ kind: "change_quantity", item: ref(1), mode: "set", quantity: 2 })).kinds).toEqual(["quantity_changed"]);
    expect(chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } }))).kinds).toEqual(["product_not_available"]);
    expect(chat.say(say({ kind: "remove", item: ref(1), amount: "all" })).kinds).toEqual(["removed"]);
  });

  test("34. «ya no el polo, así nomás» after «listo» reports ready; a new add drops the remembered «listo»", () => {
    const declined = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { order: attached() })] });
    declined.say(say(reader.ready));
    expect(declined.say(say(reader.decline(1))).kinds).toEqual(["pending_ended", "ready"]);
    const added = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { order: attached() })] });
    added.say(say(reader.ready));
    expect(added.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } }))).kinds).toEqual(["added"]);
    expect(added.say(say(complete(1, M_NEGRO))).kinds).toEqual(["pending_completed", "added"]);
  });

  test("35. «quiero 150 polos básicos» creates no pending", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "polo", quantity: 150 }))).kinds).toEqual(["quantity_above_limit"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("36. «listo» names the pending products once and counts the doubtful ones", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { n: 1 }), doubtfulPendingOf(["gorra", "snapback"], 2)] });
    expect(chat.say(say(reader.ready)).outcomes).toEqual([{ kind: "ready_with_pendings", orderId: chat.order?.id, productIds: [productId("polo")], unnamed: 1 }]);
    const doubtful = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [doubtfulPendingOf(["gorra", "snapback"], 1), doubtfulPendingOf(["polo", "oversize"], 2)] });
    expect(doubtful.say(say(reader.ready)).outcomes).toEqual([{ kind: "ready_with_pendings", orderId: doubtful.order?.id, productIds: [], unnamed: 2 }]);
  });

  test("37. «uno negro M y otro blanco L» on a ×2 pending adds two items and ends it", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.say(say(complete(1, M_NEGRO, 1), complete(1, { Talla: "L", Color: "Blanco" }, 1)));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polo básico · L · Blanco · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("38. «uno en M negro» on a ×2 pending leaves ×1 pending; «el otro blanco L» adds it", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.say(say(complete(1, M_NEGRO, 1)));
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {}']);
    chat.say(say(complete(1, { Talla: "L", Color: "Blanco" })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polo básico · L · Blanco · ×1"]);
  });

  test("39. a replacement naming a value that does not exist keeps ×2 and «blanco M» adds two", () => {
    const chat = createChat();
    chat.say(say(add({ product: "polo" })), { shown: [["polo"]] });
    expect(chat.say(say(add({ product: "polo", quantity: 2, attributes: { Color: "Rojo" } }))).kinds).toEqual(["pending_updated", "variant_not_available"]);
    chat.say(say(complete(1, { Talla: "M", Color: "Blanco" })));
    expect(chat.items()).toEqual(["Polo básico · M · Blanco · ×2"]);
  });

  test("40. «2 polos en 70» doubtful between two polos, then «el de 35 negro M» adds ×2 with the note «por 2»", () => {
    const chat = createChat();
    const doubtful: ReaderAction = { ...reader.oneOf(["polo", "polera"], undefined, 2), price: stated("70") } as ReaderAction;
    expect(chat.say(say(doubtful)).kinds).toEqual(["pending_created", "not_clear"]);
    chat.say(say(complete(1, M_NEGRO, null, "polo")));
    expect(chat.order?.items[0]).toMatchObject({ quantity: 2, mentionedPrice: { amount: { amount: 70 }, units: 2 } });
  });
});

