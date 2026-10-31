import { describe, expect, test } from "vitest";
import { renderSellerNotice } from "@core/src/features/orders/presentation/seller-notice-texts";
import type { NoticeNames } from "@core/src/features/orders/application/describe-chat-message-notice";
import type { SellerNotice } from "@core/src/features/orders/domain/seller-notice";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const order = (n: number) => id(n) as OrderId;
const product = (n: number) => id(n) as ProductId;
const names: NoticeNames = {
  orderNumbers: new Map([[order(1), 1023], [order(2), 1024]]),
  products: new Map([
    [product(1), { name: "Polo básico", attributeNames: ["talla", "color"] }],
    [product(2), { name: "Polo premium", attributeNames: ["talla"] }],
    [product(3), { name: "Gorra", attributeNames: [] }],
    [product(4), { name: "Short", attributeNames: [] }],
  ]),
};
const context = { companyId: id(100), messageId: id(101), chatId: id(102), names };
const rendered = (result: ReturnType<typeof renderSellerNotice>) => {
  if (!result.success) throw new Error(result.error.code);
  return result.data;
};
const es = (notice: SellerNotice) => rendered(renderSellerNotice(notice, "es", context));
const pt = (notice: SellerNotice) => rendered(renderSellerNotice(notice, "pt-BR", context));

describe("renderSellerNotice", () => {
  test("renders the product not recognized notice in Spanish with the data the phone opens by", () => {
    expect(es({ kind: "not_identified", source: "photo", newOrderId: null })).toEqual({
      title: "Producto no reconocido",
      body: "Un cliente envió una foto que no coincide con tu catálogo. Revisa el chat.",
      data: { v: 1, companyId: id(100), messageId: id(101), target: "message" },
      groupKey: id(102),
    });
    expect(es({ kind: "not_identified", source: "text", newOrderId: null }).body).toBe("Un cliente pidió un producto que no encontramos en tu catálogo. Revisa el chat.");
  });

  test("renders pt-BR texts for a pt-BR device", () => {
    expect(pt({ kind: "not_identified", source: "photo", newOrderId: null })).toMatchObject({
      title: "Produto não reconhecido",
      body: "Um cliente enviou uma foto que não corresponde ao seu catálogo. Veja o chat.",
    });
    expect(pt({ kind: "ready", orderId: order(1) })).toMatchObject({ title: "Pedido #1023 pronto", body: "Um cliente diz que terminou o pedido. Revise e obtenha o link." });
    expect(pt({ kind: "variant_missing", productId: product(1), newOrderId: null }).body).toBe("Um cliente pediu Polo básico mas não disse qual talla ou color. Veja o chat.");
  });

  test("names up to three products of an unclear product and counts the rest", () => {
    const body = (productIds: readonly ProductId[]) => es({ kind: "not_clear", productIds, newOrderId: null }).body;
    expect(body([product(1), product(2)])).toBe("Un cliente pidió un producto que coincide con varios de tu catálogo: Polo básico, Polo premium. Revisa el chat.");
    expect(body([product(1), product(2), product(3), product(4)])).toBe("Un cliente pidió un producto que coincide con varios de tu catálogo: Polo básico, Polo premium, Gorra y 1 más. Revisa el chat.");
  });

  test("asks for the attributes the product's variants have", () => {
    const body = (n: number) => es({ kind: "variant_missing", productId: product(n), newOrderId: null }).body;
    expect(body(1)).toBe("Un cliente pidió Polo básico pero no dijo qué talla o color. Revisa el chat.");
    expect(body(2)).toBe("Un cliente pidió Polo premium pero no dijo qué talla. Revisa el chat.");
    expect(body(3)).toBe("Un cliente pidió Gorra pero no dijo qué variante. Revisa el chat.");
  });

  test("renders the variant, quantity and unclear item notices", () => {
    expect(es({ kind: "variant_not_available", productId: product(1), newOrderId: null })).toMatchObject({
      title: "Variante no disponible", body: "Un cliente pidió una variante de Polo básico que no existe o no está a la venta. Revisa el chat." });
    expect(es({ kind: "quantity_above_limit", productId: product(1), newOrderId: null })).toMatchObject({
      title: "Revisa el chat", body: "Un cliente pidió más de 99 unidades de Polo básico. No se agregaron." });
    const unclear = (orderId: OrderId | null) => es({ kind: "unclear_item", orderId, namedItem: false, namedProductId: null, newOrderId: null }).body;
    expect(unclear(order(1))).toBe("Un cliente pidió quitar o cambiar un producto del pedido #1023, pero no sabemos cuál.");
    expect(unclear(null)).toBe("Un cliente pidió quitar o cambiar un producto, pero no tiene un pedido abierto.");
    expect(unclear(order(9))).toBe("Un cliente pidió quitar o cambiar un producto, pero no tiene un pedido abierto.");
  });

  test("names the order of a notice from the ids it carries, not from the chat's current order", () => {
    expect(es({ kind: "order_closed", orderId: order(1), newOrderId: null }).body).toBe("Un cliente pidió cambiar el pedido #1023, que ya no se puede modificar.");
    expect(es({ kind: "order_closed", orderId: order(9), newOrderId: null }).body).toBe("Un cliente pidió cambiar un pedido que ya no se puede modificar.");
  });

  test("opens the order for order notices and the message for every other notice", () => {
    expect(es({ kind: "ready", orderId: order(1) })).toMatchObject({ title: "Pedido #1023 listo", data: { target: "order" } });
    expect(es({ kind: "only_item_kept", orderId: order(1) })).toMatchObject({ title: "Revisa el pedido #1023", body: "Un cliente pidió quitar el único producto del pedido.", data: { target: "order" } });
    expect(es({ kind: "new_order", orderId: order(2), previousOrderId: order(1) })).toMatchObject({
      title: "Pedido nuevo #1024", body: "Un cliente pidió más productos después de cerrar el pedido #1023.", data: { target: "order" } });
    expect(es({ kind: "failed", newOrderId: null })).toMatchObject({ title: "No pudimos revisar un mensaje", body: "Un mensaje de un cliente no se pudo revisar. Revísalo en el chat.", data: { target: "message" } });
  });

  test("names the products of several problems and counts the rest", () => {
    const several = (problemCount: number, productIds: readonly ProductId[]) => es({ kind: "several_problems", problemCount, productIds, newOrderId: null });
    expect(several(2, [product(3)]).body).toBe("Un cliente pidió varias cosas y no pudimos aplicar 2: Gorra y otra.");
    expect(several(5, [product(3), product(1)]).body).toBe("Un cliente pidió varias cosas y no pudimos aplicar 5: Gorra, Polo básico y otras 3.");
    expect(several(2, []).body).toBe("Un cliente pidió varias cosas y no pudimos aplicar 2.");
    expect(several(2, [product(3)]).title).toBe("Revisa el chat");
  });

  test("tells a problem notice that a new order was created", () => {
    expect(es({ kind: "unnamed_add", newOrderId: order(2) }).body).toBe("Un cliente pidió más de un producto sin decir cuál. Se creó el pedido nuevo #1024.");
    expect(pt({ kind: "unnamed_add", newOrderId: order(2) }).body).toBe("Um cliente pediu mais de um produto sem dizer qual. Foi criado o novo pedido #1024.");
    expect(es({ kind: "unnamed_add", newOrderId: order(9) }).body).toBe("Un cliente pidió más de un producto sin decir cuál.");
  });

  test("refuses to render push data that does not match the shared contract", () => {
    expect(renderSellerNotice({ kind: "failed", newOrderId: null }, "es", { ...context, messageId: "not-a-uuid" }))
      .toMatchObject({ success: false, error: { code: "INVALID_NOTICE_DATA", retryable: false } });
  });
});

describe("renderSellerNotice with the single reader", () => {
  const ready = (orderId: OrderId | null, productIds: readonly ProductId[], unnamed: number): SellerNotice => ({ kind: "ready_with_pendings", orderId, productIds, unnamed });
  const several = (productIds: readonly ProductId[], unnamed: number): SellerNotice => ({ kind: "variant_for_several_pendings", productIds, unnamed, newOrderId: null });

  test("writes «falta completar Polo básico y 1 más» with one named and one doubtful pending", () => {
    expect(es(ready(order(1), [product(1)], 1))).toMatchObject({
      title: "Revisa el chat", body: "Un cliente dice que terminó el pedido #1023, pero falta completar Polo básico y 1 más.", data: { target: "message" } });
    expect(pt(ready(order(1), [product(1)], 1))).toMatchObject({
      title: "Veja o chat", body: "Um cliente diz que terminou o pedido #1023, mas falta completar Polo básico e mais 1." });
    expect(es(ready(null, [product(1)], 0)).body).toBe("Un cliente dice que terminó su pedido, pero falta completar Polo básico.");
    expect(pt(ready(null, [product(1)], 0)).body).toBe("Um cliente diz que terminou o pedido, mas falta completar Polo básico.");
    expect(es(ready(order(9), [product(1), product(2)], 0)).body).toBe("Un cliente dice que terminó su pedido, pero falta completar Polo básico y Polo premium.");
  });

  test("writes «falta completar 2 productos» when no pending has a name", () => {
    expect(es(ready(order(1), [], 1)).body).toBe("Un cliente dice que terminó el pedido #1023, pero falta completar un producto.");
    expect(es(ready(order(1), [], 2)).body).toBe("Un cliente dice que terminó el pedido #1023, pero falta completar 2 productos.");
    expect(pt(ready(order(1), [], 1)).body).toBe("Um cliente diz que terminou o pedido #1023, mas falta completar um produto.");
    expect(pt(ready(order(1), [], 2)).body).toBe("Um cliente diz que terminou o pedido #1023, mas falta completar 2 produtos.");
    // A product deleted since the message has no name either.
    expect(es(ready(order(1), [product(99)], 1)).body).toBe("Un cliente dice que terminó el pedido #1023, pero falta completar 2 productos.");
  });

  test("writes the several-pendings variant text with up to three names", () => {
    expect(es(several([product(1), product(2)], 0))).toMatchObject({
      title: "Revisa el chat", body: "Un cliente mencionó una variante sin decir de cuál producto: Polo básico y Polo premium.", data: { target: "message" } });
    expect(pt(several([product(1), product(2)], 0)).body).toBe("Um cliente mencionou uma variante sem dizer de qual produto: Polo básico e Polo premium.");
    expect(es(several([product(1), product(2), product(3), product(4)], 0)).body).toBe("Un cliente mencionó una variante sin decir de cuál producto: Polo básico, Polo premium, Gorra y 1 más.");
    expect(es(several([product(1), product(2)], 2)).body).toBe("Un cliente mencionó una variante sin decir de cuál producto: Polo básico, Polo premium y 2 más.");
    expect(es(several([], 3)).body).toBe("Un cliente mencionó una variante sin decir de cuál de 3 productos.");
    expect(pt(several([], 3)).body).toBe("Um cliente mencionou uma variante sem dizer de qual de 3 produtos.");
  });

  test("writes the product-not-available text without a name for a deleted product", () => {
    const notice = (productId: ProductId | null): SellerNotice => ({ kind: "product_not_available", productId, newOrderId: null });
    expect(es(notice(product(1)))).toMatchObject({ title: "Producto no disponible", body: "Un cliente pidió Polo básico, que ya no está a la venta. Revisa el chat.", data: { target: "message" } });
    expect(pt(notice(product(1)))).toMatchObject({ title: "Produto indisponível", body: "Um cliente pediu Polo básico, que não está mais à venda. Veja o chat." });
    expect(es(notice(null)).body).toBe("Un cliente pidió un producto que ya no está a la venta. Revisa el chat.");
    expect(es(notice(product(99))).body).toBe("Un cliente pidió un producto que ya no está a la venta. Revisa el chat.");
    expect(pt(notice(null)).body).toBe("Um cliente pediu um produto que não está mais à venda. Veja o chat.");
  });

  test("writes the photo-added text with the product and order number in es and pt-BR", () => {
    const notice = (orderId: OrderId | null): SellerNotice => ({ kind: "caption_not_applied", productId: product(3), orderId, newOrderId: null });
    expect(es(notice(order(1)))).toMatchObject({ title: "Revisa el chat", body: "Un cliente envió una foto de Gorra y la agregamos al pedido #1023, pero no pudimos aplicar lo que escribió." });
    expect(pt(notice(order(1)))).toMatchObject({ title: "Veja o chat", body: "Um cliente enviou uma foto de Gorra e a adicionamos ao pedido #1023, mas não conseguimos aplicar o que escreveu." });
    expect(es(notice(null)).body).toBe("Un cliente envió una foto de Gorra y la agregamos a un pedido, pero no pudimos aplicar lo que escribió.");
    expect(pt(notice(null)).body).toBe("Um cliente enviou uma foto de Gorra e a adicionamos a um pedido, mas não conseguimos aplicar o que escreveu.");
  });

  test("writes the generic not-applied text with and without an order number", () => {
    const notice = (orderId: OrderId | null): SellerNotice => ({ kind: "not_applied", orderId, newOrderId: null });
    expect(es(notice(order(1)))).toMatchObject({ title: "Revisa el chat", body: "Un cliente escribió algo sobre el pedido #1023 que no pudimos aplicar.", data: { target: "message" } });
    expect(pt(notice(order(1)))).toMatchObject({ title: "Veja o chat", body: "Um cliente escreveu algo sobre o pedido #1023 que não conseguimos aplicar." });
    expect(es(notice(null)).body).toBe("Un cliente escribió algo que no pudimos aplicar a un pedido.");
    expect(pt(notice(order(9))).body).toBe("Um cliente escreveu algo que não conseguimos aplicar a um pedido.");
  });

  describe("payment request", () => {
    const payment = (orderState: Extract<SellerNotice, { kind: "payment_request" }>["order"], productIds: ProductId[] = [], unnamed = 0, newOrderId: OrderId | null = null): SellerNotice =>
      ({ kind: "payment_request", order: orderState, productIds, unnamed, newOrderId });
    const open = { kind: "open", orderId: order(1) } as const;
    const closed = { kind: "closed", orderId: order(1) } as const;
    const none = { kind: "none" } as const;

    test("renders every payment request body in es and pt-BR", () => {
      expect(es(payment(open))).toMatchObject({ title: "Revisa el chat", body: "Un cliente quiere pagar el pedido #1023.", data: { target: "message" } });
      expect(pt(payment(open))).toMatchObject({ title: "Veja o chat", body: "Um cliente quer pagar o pedido #1023." });
      expect(es(payment(none)).body).toBe("Un cliente quiere pagar.");
      expect(pt(payment(none)).body).toBe("Um cliente quer pagar.");
      expect(es(payment(closed)).body).toBe("Un cliente quiere pagar, pero el pedido #1023 ya tiene un pago o está cerrado. Revisa el chat.");
      expect(pt(payment(closed)).body).toBe("Um cliente quer pagar, mas o pedido #1023 já tem um pagamento ou está fechado. Veja o chat.");
      expect(es(payment(open, [product(1)])).body).toBe("Un cliente quiere pagar el pedido #1023, pero falta completar Polo básico.");
      expect(pt(payment(open, [product(1)])).body).toBe("Um cliente quer pagar o pedido #1023, mas falta completar Polo básico.");
      expect(es(payment(none, [product(1), product(2)])).body).toBe("Un cliente quiere pagar, pero falta completar Polo básico y Polo premium.");
      expect(pt(payment(none, [product(1), product(2)])).body).toBe("Um cliente quer pagar, mas falta completar Polo básico e Polo premium.");
    });

    test("lists up to three names and counts the rest and the unnamed pendings", () => {
      expect(es(payment(open, [product(1), product(2), product(3), product(4)], 1)).body)
        .toBe("Un cliente quiere pagar el pedido #1023, pero falta completar Polo básico, Polo premium, Gorra y 2 más.");
      expect(pt(payment(none, [], 2)).body).toBe("Um cliente quer pagar, mas falta completar 2 produtos.");
    });

    test("the closed-order payment body is used whether or not a pending is left", () => {
      expect(es(payment(closed, [product(1)])).body).toBe(es(payment(closed)).body);
    });

    test("a payment request that created a new order ends with the new-order note", () => {
      expect(es(payment(open, [], 0, order(2))).body).toBe("Un cliente quiere pagar el pedido #1023. Se creó el pedido nuevo #1024.");
      expect(pt(payment(open, [], 0, order(2))).body).toBe("Um cliente quer pagar o pedido #1023. Foi criado o novo pedido #1024.");
    });

    test("a payment request on a deleted order renders the body without an order", () => {
      expect(es(payment({ kind: "open", orderId: order(99) })).body).toBe("Un cliente quiere pagar.");
      expect(es(payment({ kind: "closed", orderId: order(99) }, [product(1)])).body).toBe("Un cliente quiere pagar, pero falta completar Polo básico.");
      expect(pt(payment({ kind: "open", orderId: order(99) })).body).toBe("Um cliente quer pagar.");
    });
  });
});
