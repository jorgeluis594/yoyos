import { describe, expect, test } from "vitest";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, ContactId, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import { orderEdit, type DeliveryAmendment, type DeliveryEdit, type OrderLineQuantity, type OrderLineRequest, type OrderPart } from "@core/src/features/orders/domain/order-edit";
import type { DeliveryPricing, DeliverySnapshot, OrderAggregate, PeruDeliveryDistrict, RatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-09-29T12:00:00Z");
const seller = { kind: "seller", userId: "seller" as UserId } as const;
const other = { kind: "seller", userId: "other" as UserId } as const;
const district = { country: "PE", districtCode: "150101", district: "Lima", province: "Lima", department: "Lima" } as unknown as PeruDeliveryDistrict;
const pricing = { quotationId: id(20), rateId: id(21), optionId: id(22), settingsVersion: 1 } as DeliveryPricing;
const ana = { name: "Ana", phone: "999", identity: { kind: "absent" } } as const;
const home: DeliverySnapshot = { method: "home", recipient: ana, destination: { ...district, address: "Av. Lima 123", instructions: "Timbre roto" }, pricing, recordedBy: { kind: "buyer" } };

const variantOf = (n: number) => id(n + 100) as VariantId;
const item = (n: number, name: string, attributes: Record<string, string>, quantity: number, unit: number): OrderItem => ({ id: id(n) as OrderItemId, variantId: variantOf(n),
  productName: name, variantAttributes: attributes, sku: `SKU-${n}`, quantity: quantity as PositiveInteger, unitPrice: money(unit), subtotal: money(unit * quantity), mentionedPrice: null });
// Order 1042: two «Traje» lines at S/ 89.00 and «Deadpool · M» at S/ 120.00.
const traje = (n: number, size: string) => item(n, "Traje", { Talla: size }, 1, 89);
const deadpool = item(5, "Deadpool", { Talla: "M" }, 1, 120);
const order = (overrides: Partial<OrderAggregate> = {}): OrderAggregate => ({
  number: 1042 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, fromCatalog: false,
  buyer: { contactId: id(50) as ContactId, name: "Luis", phone: "+51999111222" }, checkoutEnabledAt: null, checkoutConfirmedAt: null,
  createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
  items: [traje(3, "S"), traje(4, "M"), deadpool], payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(298), deliveryCost: money(0), deliveryCharge: money(0), total: money(298), ...overrides,
});
const withHome = (overrides: Partial<OrderAggregate> = {}) => order({ delivery: home, deliveryCost: money(10), deliveryCharge: money(10), total: money(308), ...overrides });
const line = (variantId: VariantId, quantity: number): OrderLineRequest => ({ variantId, quantity: quantity as OrderLineQuantity });
const keepAll = [line(variantOf(3), 1), line(variantOf(4), 1), line(variantOf(5), 1)];
const sellable = (n: number, unit: number, name = "Nuevo"): SellableVariant => ({ variantId: variantOf(n), productName: name, variantAttributes: { Talla: "L" }, sku: null, unitPrice: money(unit), available: 5 });
let counter = 900;
const newId = () => id(counter++) as OrderItemId;
const unwrap = <T, E>(result: { success: true; data: T } | { success: false; error: E }) => { if (!result.success) throw new Error(JSON.stringify(result.error)); return result.data; };

describe("isApplied", () => {
  test("drops an items part equal to the stored items even when stock is deducted", () => {
    const deducted = order({ stockDeducted: true, stockDeductedAt: at, deliveryStatus: "shipped" });
    expect(orderEdit.isApplied(deducted, { items: { lines: [...keepAll].reverse() } }, "items")).toBe(true);
    expect(orderEdit.isApplied(deducted, { items: { lines: [line(variantOf(3), 2), ...keepAll.slice(1)] } }, "items")).toBe(false);
    expect(orderEdit.isApplied(deducted, { items: { lines: keepAll.slice(1) } }, "items")).toBe(false);
  });

  test("is false for a part that was not sent", () => {
    expect(orderEdit.isApplied(order(), {}, "items")).toBe(false);
    expect(orderEdit.isApplied(order(), {}, "customer")).toBe(false);
    expect(orderEdit.isApplied(order(), {}, "delivery")).toBe(false);
  });

  test("compares name and phone of the customer, with null meaning empty", () => {
    const buyer = { name: "Luis", phone: "+51999111222" } as never;
    expect(orderEdit.isApplied(order(), { customer: { value: buyer } }, "customer")).toBe(true);
    expect(orderEdit.isApplied(order(), { customer: { value: { name: "Luis", phone: "+51999111333" } as never } }, "customer")).toBe(false);
    expect(orderEdit.isApplied(order({ buyer: null }), { customer: { value: null } }, "customer")).toBe(true);
    expect(orderEdit.isApplied(order({ buyer: { contactId: id(50) as ContactId, name: null, phone: null } }), { customer: { value: null } }, "customer")).toBe(true);
    expect(orderEdit.isApplied(order(), { customer: { value: null } }, "customer")).toBe(false);
  });

  test("compares an amendment with the stored recipient, address and reference", () => {
    const same: DeliveryEdit = { kind: "amend", amendment: { method: "home", recipient: ana, address: "Av. Lima 123", instructions: "Timbre roto" } };
    expect(orderEdit.isApplied(withHome(), { delivery: { change: same } }, "delivery")).toBe(true);
    const moved: DeliveryEdit = { kind: "amend", amendment: { method: "home", recipient: ana, address: "Av. Lima 999", instructions: "Timbre roto" } };
    expect(orderEdit.isApplied(withHome(), { delivery: { change: moved } }, "delivery")).toBe(false);
    expect(orderEdit.isApplied(order(), { delivery: { change: same } }, "delivery")).toBe(false);
  });

  test("applies a replaced delivery only when rate, place, recipient, seller author and charge all match", () => {
    const selection: RatedDeliverySelection = { method: "home", recipient: ana, rateId: pricing.rateId,
      destination: { districtCode: district.districtCode, address: "Av. Lima 123", instructions: "Timbre roto" } };
    const replace: DeliveryEdit = { kind: "replace", selection, expectedPrice: money(10) };
    const bySeller = withHome({ delivery: { ...home, recordedBy: seller } });
    expect(orderEdit.isApplied(bySeller, { delivery: { change: replace } }, "delivery")).toBe(true);
    expect(orderEdit.isApplied(withHome(), { delivery: { change: replace } }, "delivery")).toBe(false);
    expect(orderEdit.isApplied(bySeller, { delivery: { change: { ...replace, expectedPrice: money(12) } } }, "delivery")).toBe(false);
    expect(orderEdit.isApplied(withHome({ delivery: { ...home, recordedBy: other } }), { delivery: { change: replace } }, "delivery")).toBe(true);
    const otherRate = { ...selection, rateId: id(99) } as RatedDeliverySelection;
    expect(orderEdit.isApplied(bySeller, { delivery: { change: { ...replace, selection: otherRate } } }, "delivery")).toBe(false);
  });
});

describe("checkLocks", () => {
  const all = new Set<OrderPart>(["items", "customer", "delivery"]);
  test("refuses any edit of a cancelled order", () => {
    const cancelled = order({ cancelled: true, cancelledAt: at });
    for (const part of all) expect(orderEdit.checkLocks(cancelled, new Set([part]))).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
  });

  test("refuses items and delivery edits once the delivery left pending but allows a customer edit", () => {
    const shipped = order({ deliveryStatus: "shipped", shippedAt: at, stockDeducted: true, stockDeductedAt: at });
    expect(orderEdit.checkLocks(shipped, new Set(["items"]))).toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
    expect(orderEdit.checkLocks(shipped, new Set(["delivery"]))).toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
    expect(orderEdit.checkLocks(shipped, new Set(["customer"]))).toEqual({ success: true, data: null });
  });

  test("refuses items edits once stock is deducted but allows customer and delivery edits", () => {
    const deducted = order({ stockDeducted: true, stockDeductedAt: at });
    expect(orderEdit.checkLocks(deducted, new Set(["items"]))).toMatchObject({ success: false, error: { code: "ITEMS_LOCKED" } });
    expect(orderEdit.checkLocks(deducted, new Set(["items", "customer"]))).toMatchObject({ success: false, error: { code: "ITEMS_LOCKED" } });
    expect(orderEdit.checkLocks(deducted, new Set(["customer", "delivery"]))).toEqual({ success: true, data: null });
  });

  test("allows everything on an open order and nothing to check when no part remains", () => {
    expect(orderEdit.checkLocks(order(), all)).toEqual({ success: true, data: null });
    expect(orderEdit.checkLocks(order({ cancelled: true, cancelledAt: at }), new Set())).toEqual({ success: true, data: null });
  });
});

describe("planItems and applyItems", () => {
  test("refuses an empty list, a repeated variant, more than 100 lines and a quantity above 9999", () => {
    expect(orderEdit.planItems(order(), [])).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(orderEdit.planItems(order(), [line(variantOf(3), 1), line(variantOf(3), 2)])).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    const many = Array.from({ length: 101 }, (_, index) => line(variantOf(1000 + index), 1));
    expect(orderEdit.planItems(order(), many)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(orderEdit.planItems(order(), Array.from({ length: 100 }, (_, index) => line(variantOf(1000 + index), 1)))).toMatchObject({ success: true });
    for (const quantity of [10000, 0, -1, 1.5]) expect(orderEdit.planItems(order(), [line(variantOf(3), quantity)])).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(orderEdit.planItems(order(), [line(variantOf(3), 9999)])).toMatchObject({ success: true });
  });

  test("asks to look up only new and raised variants", () => {
    const lines = [line(variantOf(3), 1), line(variantOf(4), 1), line(variantOf(5), 3), line(variantOf(7), 1)];
    expect(unwrap(orderEdit.planItems(order(), lines))).toEqual({ lookup: [variantOf(5), variantOf(7)] });
    expect(unwrap(orderEdit.planItems(order(), [line(variantOf(3), 1)]))).toEqual({ lookup: [] });
  });

  test("raising Deadpool M from 1 to 2 gives an items total of 418.00 and keeps S/ 89.00 on the Traje lines", () => {
    const catalog = [{ ...sellable(5, 130, "Deadpool"), variantAttributes: { Talla: "M" } }, sellable(3, 95, "Traje"), sellable(4, 95, "Traje")];
    const result = unwrap(orderEdit.applyItems(order(), [line(variantOf(3), 1), line(variantOf(4), 1), line(variantOf(5), 2)], catalog, newId));
    expect(result.order.itemsTotal).toEqual(money(418));
    expect(result.order.total).toEqual(money(418));
    expect(result.order.items.filter((entry) => entry.productName === "Traje").map((entry) => entry.unitPrice)).toEqual([money(89), money(89)]);
    expect(result.order.items.find((entry) => entry.productName === "Deadpool")).toMatchObject({ quantity: 2, unitPrice: money(120), subtotal: money(240) });
    expect(result.changes).toEqual({ added: [], updated: [expect.objectContaining({ id: id(5), quantity: 2 })], removedItemIds: [] });
  });

  test("keeps the copied price, name and mentioned price of a kept line whose quantity changes", () => {
    const mentioned = { amount: money(70), units: 1 };
    const base = order({ items: [{ ...traje(3, "S"), mentionedPrice: mentioned }, traje(4, "M")] as never, itemsTotal: money(178), total: money(178) });
    const result = unwrap(orderEdit.applyItems(base, [line(variantOf(3), 1), line(variantOf(4), 3)], [sellable(4, 95)], newId));
    expect(result.order.items[1]).toMatchObject({ id: id(4), productName: "Traje", variantAttributes: { Talla: "M" }, sku: "SKU-4", unitPrice: money(89), quantity: 3, subtotal: money(267) });
    expect(result.order.items[0]!.mentionedPrice).toEqual(mentioned);
  });

  test("lowering a line never needs the catalog", () => {
    const result = unwrap(orderEdit.applyItems(order({ items: [traje(3, "S"), item(4, "Traje", { Talla: "M" }, 3, 89)] as never }), [line(variantOf(3), 1), line(variantOf(4), 1)], [], newId));
    expect(result.changes.updated).toEqual([expect.objectContaining({ id: id(4), quantity: 1, subtotal: money(89) })]);
  });

  test("keeps the item id of a variant removed and added back in the same request", () => {
    const result = unwrap(orderEdit.applyItems(order(), keepAll, [], newId));
    expect(result.order.items.map((entry) => entry.id)).toEqual([id(3), id(4), id(5)]);
    expect(result.changes).toEqual({ added: [], updated: [], removedItemIds: [] });
  });

  test("prices a new line with the current catalog price and reports it as added", () => {
    const result = unwrap(orderEdit.applyItems(order(), [...keepAll, line(variantOf(7), 2)], [sellable(7, 95)], () => id(700) as OrderItemId));
    const added = result.order.items.find((entry) => entry.variantId === variantOf(7));
    expect(added).toMatchObject({ id: id(700), productName: "Nuevo", unitPrice: money(95), quantity: 2, subtotal: money(190), mentionedPrice: null });
    expect(result.changes.added).toEqual([added]);
    expect(result.order.itemsTotal).toEqual(money(488));
  });

  test("reports removed items and refuses removing every kept line without a replacement", () => {
    const result = unwrap(orderEdit.applyItems(order(), [line(variantOf(3), 1)], [], newId));
    expect(result.changes.removedItemIds).toEqual([id(4), id(5)]);
    expect(result.order.items).toHaveLength(1);
    expect(orderEdit.applyItems(order(), [], [], newId)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  });

  test("allows lowering a line whose variant is no longer sellable", () => {
    const result = orderEdit.applyItems(order({ items: [traje(3, "S"), item(4, "Traje", { Talla: "M" }, 2, 89)] as never }), [line(variantOf(3), 1), line(variantOf(4), 1)], [], newId);
    expect(result).toMatchObject({ success: true });
  });

  test("refuses raising a line whose variant is no longer sellable with its variantId", () => {
    expect(orderEdit.applyItems(order(), [line(variantOf(3), 1), line(variantOf(4), 5)], [], newId))
      .toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: variantOf(4) } });
  });

  test("refuses a new variant that is missing, naming the first one in request order", () => {
    expect(orderEdit.applyItems(order(), [...keepAll, line(variantOf(8), 1), line(variantOf(7), 1)], [sellable(7, 10)], newId))
      .toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: variantOf(8) } });
  });

  test("recalculates items total and total keeping the delivery charge", () => {
    const result = unwrap(orderEdit.applyItems(withHome(), [line(variantOf(3), 2), line(variantOf(4), 1), line(variantOf(5), 1)], [sellable(3, 95)], newId));
    expect(result.order).toMatchObject({ itemsTotal: money(387), deliveryCharge: money(10), deliveryCost: money(10), total: money(397) });
  });

  test("refuses a new variant in another currency", () => {
    const usd = { ...sellable(7, 10), unitPrice: { amount: 10, currency: "USD" as const } };
    expect(orderEdit.applyItems(order(), [...keepAll, line(variantOf(7), 1)], [usd], newId)).toMatchObject({ success: false, error: { code: "CURRENCY_MISMATCH" } });
  });
});

describe("applyCustomer", () => {
  test("sets a customer keeping the contact link", () => {
    expect(orderEdit.applyCustomer(order(), { name: "Rosa", phone: "+51999000111" } as never).buyer).toEqual({ contactId: id(50), name: "Rosa", phone: "+51999000111" });
    expect(orderEdit.applyCustomer(order({ buyer: null }), { name: "Rosa", phone: "+51999000111" } as never).buyer).toEqual({ contactId: null, name: "Rosa", phone: "+51999000111" });
  });

  test("empties name and phone but keeps the contact when clearing a contact customer", () => {
    expect(orderEdit.applyCustomer(order(), null).buyer).toEqual({ contactId: id(50), name: null, phone: null });
  });

  test("removes the buyer when clearing a customer without contact", () => {
    expect(orderEdit.applyCustomer(order({ buyer: { contactId: null, name: "Rosa", phone: "+51999000111" } }), null).buyer).toBeNull();
    expect(orderEdit.applyCustomer(order({ buyer: null }), null).buyer).toBeNull();
  });
});

describe("amendDelivery", () => {
  const amendHome = (changes: Partial<Extract<DeliveryAmendment, { method: "home" }>> = {}): DeliveryAmendment =>
    ({ method: "home", recipient: { name: "Rosa", phone: "888", identity: { kind: "absent" } }, address: "Jr. Nuevo 45", instructions: null, ...changes });

  test("amends the recipient and address of a home delivery without changing its pricing or total", () => {
    const base = withHome();
    const amended = unwrap(orderEdit.amendDelivery(base, amendHome(), seller));
    expect(amended.delivery).toMatchObject({ method: "home", recipient: { name: "Rosa", phone: "888" }, destination: { address: "Jr. Nuevo 45", districtCode: "150101", district: "Lima" }, pricing });
    expect(amended).toMatchObject({ total: base.total, deliveryCost: base.deliveryCost, deliveryCharge: base.deliveryCharge, itemsTotal: base.itemsTotal });
  });

  test("clears the reference of a home delivery", () => {
    const amended = unwrap(orderEdit.amendDelivery(withHome(), amendHome({ instructions: null }), seller));
    expect(amended.delivery).toMatchObject({ destination: { instructions: null } });
  });

  test("records the seller as author of an amended delivery", () => {
    expect(unwrap(orderEdit.amendDelivery(withHome(), amendHome(), seller)).delivery?.recordedBy).toEqual(seller);
  });

  test("amends only the recipient of a store delivery", () => {
    const store: DeliverySnapshot = { method: "store", recipient: ana, pickupPoint: { name: "Tienda", address: "Av. 1", instructions: null }, settingsVersion: 3 as never, recordedBy: { kind: "buyer" } };
    const amended = unwrap(orderEdit.amendDelivery(order({ delivery: store }), { method: "store", recipient: { ...ana, name: "Rosa" } }, seller));
    expect(amended.delivery).toMatchObject({ method: "store", recipient: { name: "Rosa" }, pickupPoint: store.method === "store" ? store.pickupPoint : null, recordedBy: seller });
  });

  test("refuses an amendment whose method does not match the stored delivery", () => {
    expect(orderEdit.amendDelivery(withHome(), { method: "store", recipient: ana }, seller)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(orderEdit.amendDelivery(order(), amendHome(), seller)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  });

  test("refuses an amendment that breaks the snapshot rules", () => {
    expect(orderEdit.amendDelivery(withHome(), amendHome({ address: "  " }), seller)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  });
});
