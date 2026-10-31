import { describe, expect, test } from "vitest";
import { fixedShownAnswer } from "@core/src/features/orders/domain/chat-reading";
import { chooseSellerNotice } from "@core/src/features/orders/domain/seller-notice";
import { renderSellerNotice } from "@core/src/features/orders/presentation/seller-notice-texts";
import type { NoticeNames } from "@core/src/features/orders/application/describe-chat-message-notice";
import { createChat, id, productId, reader, stated, type Chat, type ProductKey, type Said } from "@core/src/features/orders/domain/chat-reading-fixtures";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

/**
 * The acceptance criteria of the product draft that read a message end to end: fixed reader answers go through the real
 * order transitions, the notice the outcomes call for is chosen and its text is written, as the seller's phone would show it.
 */
const { add, say } = reader;
const M_NEGRO = { Talla: "M", Color: "Negro" } as const;
const productKeys: readonly ProductKey[] = ["polo", "oversize", "premium", "gorra", "snapback", "polera", "medias"];
const productNames: Record<ProductKey, string> = { polo: "Polo básico", oversize: "Polo oversize", premium: "Polo premium", gorra: "Gorra trucker", snapback: "Gorra snapback", polera: "Polera con capucha", medias: "Medias deportivas pack x3" };

/** The notice the seller's phone shows for a message in a chat: null when the message calls for none. */
function noticeOf(chat: Chat, said: Said) {
  const [first, ...rest] = said.outcomes;
  const notice = first ? chooseSellerNotice([first, ...rest]) : null;
  if (!notice) return null;
  const orderNumbers = new Map(chat.orders.map((order) => [order.id, order.number as number]));
  const products = new Map(productKeys.map((key) => [productId(key), { name: productNames[key], attributeNames: ["talla", "color"] }]));
  const names: NoticeNames = { orderNumbers, products };
  const rendered = renderSellerNotice(notice, "es", { companyId: id(100), messageId: id(101), chatId: id(102), names });
  if (!rendered.success) throw new Error(rendered.error.code);
  return { kind: notice.kind, title: rendered.data.title, body: rendered.data.body };
}

/** `Gorra snapback · Azul · ×1 · S/ 30.00`: name · variant · quantity · unit price, the way the web shows an item. */
const pricedItems = (order: OrderAggregate | null) => (order?.items ?? []).map((item) =>
  [item.productName, ...Object.values(item.variantAttributes), `×${item.quantity}`, `S/ ${item.unitPrice.amount.toFixed(2)}`].join(" · "));

describe("criteria 1 and 2: a photo with a caption without intent", () => {
  test("1. a caption read as no intent leaves the pending of the polo and «Falta la variante», then «M blanco» orders it with no notice", () => {
    const chat = createChat();
    const photo = chat.say({ kind: "no_intent" }, { shown: [["polo"]] });
    expect(chat.order).toBeNull();
    expect(chat.pendingLines()).toEqual(["Polo básico ×1 {}"]);
    expect(noticeOf(chat, photo)).toEqual({ kind: "variant_missing", title: "Falta la variante",
      body: "Un cliente pidió Polo básico pero no dijo qué talla o color. Revisa el chat." });
    const completed = chat.say(say(reader.complete(1, { Talla: "M", Color: "Blanco" })));
    expect(noticeOf(chat, completed)).toBeNull();
    expect(chat.pendings.pendings).toEqual([]);
    expect(chat.orders).toHaveLength(1);
    expect(pricedItems(chat.order)).toEqual(["Polo básico · M · Blanco · ×1 · S/ 35.00"]);
  });

  test("2. a caption read as no intent adds the gorra snapback to a new order with its price and no notice", () => {
    const chat = createChat();
    const photo = chat.say({ kind: "no_intent" }, { shown: [["snapback"]] });
    expect(photo.kinds).toEqual(["added"]);
    expect(noticeOf(chat, photo)).toBeNull();
    expect(chat.orders).toHaveLength(1);
    expect(pricedItems(chat.order)).toEqual(["Gorra snapback · Azul · ×1 · S/ 30.00"]);
  });

  test("2. a caption the reader doubts adds the same gorra to a new order and the seller is told to check the chat", () => {
    const chat = createChat();
    const photo = chat.say({ kind: "doubt" }, { shown: [["snapback"]], captionDoubt: true });
    expect(chat.orders).toHaveLength(1);
    expect(pricedItems(chat.order)).toEqual(["Gorra snapback · Azul · ×1 · S/ 30.00"]);
    expect(noticeOf(chat, photo)).toEqual({ kind: "caption_not_applied", title: "Revisa el chat",
      body: `Un cliente envió una foto de Gorra snapback y la agregamos al pedido #${chat.order!.number}, pero no pudimos aplicar lo que escribió.` });
  });
});

describe("criterion 4: a caption with only emoji", () => {
  test("the photo of the polo leaves a pending and the seller gets «Falta la variante»", () => {
    const chat = createChat();
    const photo = chat.say(fixedShownAnswer(chat.context({ shown: [["polo"]] })), { shown: [["polo"]] });
    expect(photo.kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.order).toBeNull();
    expect(noticeOf(chat, photo)).toMatchObject({ kind: "variant_missing", title: "Falta la variante" });
  });
});

describe("criteria 5 and 6: payment requests and questions about paying", () => {
  const payment = (chat: Chat) => noticeOf(chat, chat.say(say(reader.payment)));

  test("5. «pásame el link para pagarte» changes nothing and names the open order", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    expect(payment(chat)).toEqual({ kind: "payment_request", title: "Revisa el chat", body: "Un cliente quiere pagar el pedido #1023." });
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
    expect(chat.orders).toHaveLength(1);
    expect(chat.order!.payments).toEqual([]);
  });

  test("5. with no order the notice does not name one and no order is created", () => {
    const chat = createChat();
    expect(payment(chat)).toEqual({ kind: "payment_request", title: "Revisa el chat", body: "Un cliente quiere pagar." });
    expect(chat.orders).toEqual([]);
  });

  test("5. with a payment already reported the order is closed and the notice says so", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    chat.mutate((order) => ({ ...order, payments: [{ id: "payment", orderId: order.id, status: "confirmed", amount: { amount: 35, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false,
      data: { confirmedAt: new Date(), confirmedBy: { kind: "seller", userId: "seller" }, evidence: { kind: "buyer_report", report: { receiptImageId: "receipt", reportedAt: new Date() } } } } as never] }));
    expect(payment(chat)).toEqual({ kind: "payment_request", title: "Revisa el chat", body: "Un cliente quiere pagar, pero el pedido #1023 ya tiene un pago o está cerrado. Revisa el chat." });
    expect(chat.order!.payments).toHaveLength(1);
  });

  test("6. a question about the payment methods or a payment already made, read as no intent, changes nothing and sends no notice", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    const before = chat.order;
    const said = chat.say({ kind: "no_intent" });
    expect(said.kinds).toEqual(["no_intent"]);
    expect(noticeOf(chat, said)).toBeNull();
    expect(chat.order).toEqual(before);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
  });
});

describe("criterion 9: a message with two problems", () => {
  test("120 gorras plus an instruction to set their price add nothing and the seller is told two problems", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "gorra", attributes: { Color: "Negro" }, quantity: 120 }), reader.notAllowed));
    expect(said.kinds).toEqual(["quantity_above_limit", "request_not_allowed"]);
    expect(chat.order).toBeNull();
    expect(chat.items()).toEqual([]);
    expect(noticeOf(chat, said)).toEqual({ kind: "several_problems", title: "Revisa el chat", body: "Un cliente pidió varias cosas y no pudimos aplicar 2: Gorra trucker y otra." });
  });

  test("on an open order the problems leave its items as they were", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    chat.say(say(add({ product: "gorra", attributes: { Color: "Negro" }, quantity: 120 }), reader.notAllowed));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
  });
});

describe("criteria 28 and 29: the price the buyer said", () => {
  test("28. a price in another currency is dropped: the item keeps the catalog price and no notice is sent", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" }, quantity: 2, price: { amount: "8", currency: "other", per: "not_explicit" } })));
    expect(said.kinds).toEqual(["added"]);
    expect(noticeOf(chat, said)).toBeNull();
    expect(pricedItems(chat.order)).toEqual(["Gorra trucker · Rojo · ×2 · S/ 25.00"]);
    expect(chat.order!.items[0]?.mentionedPrice ?? null).toBeNull();
  });

  test("29. a price equal to the catalog price of the polo is kept for one unit and sends no notice", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "polo", attributes: M_NEGRO, price: stated("35") })));
    expect(said.kinds).toEqual(["added"]);
    expect(noticeOf(chat, said)).toBeNull();
    expect(pricedItems(chat.order)).toEqual(["Polo básico · M · Negro · ×1 · S/ 35.00"]);
    expect(chat.order!.items[0]?.mentionedPrice).toMatchObject({ amount: { amount: 35, currency: "PEN" }, units: 1 });
  });
});
