import { describe, expect, test } from "vitest";
import { renderSellerNotice, type NoticeNames } from "@core/src/features/orders/presentation/seller-notice-texts";
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
const es = (notice: SellerNotice) => renderSellerNotice(notice, "es", context);
const pt = (notice: SellerNotice) => renderSellerNotice(notice, "pt-BR", context);

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
});
