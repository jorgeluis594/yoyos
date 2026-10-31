import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, ContactId, OrderId, OrderItem, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { DeliveryEdit, OrderLineQuantity, OrderLineRequest, OrderPart } from "@core/src/features/orders/domain/order-edit";
import { orderRevisions } from "@core/src/features/orders/domain/order-revisions";
import { parseDeliverySnapshot, type DeliveryPricing, type DeliverySnapshot, type OrderAggregate, type Payment, type PeruDeliveryDistrict, type RatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";
import { editOrder, type EditOrderDependencies, type EditOrderInput } from "@core/src/features/orders/application/edit-order";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-09-29T12:00:00Z");
const access = { companyId: id(2) as CompanyId, userId: "seller" as UserId };
const district = { country: "PE", districtCode: "150101", district: "Lima", province: "Lima", department: "Lima" } as unknown as PeruDeliveryDistrict;
const pricing = { quotationId: id(20), rateId: id(21), optionId: id(22), settingsVersion: 1 } as DeliveryPricing;
const ana = { name: "Ana", phone: "999", identity: { kind: "absent" } } as const;
const home: DeliverySnapshot = { method: "home", recipient: ana, destination: { ...district, address: "Av. Lima 123", instructions: "Timbre roto" }, pricing, recordedBy: { kind: "buyer" } };

const variantOf = (n: number) => id(n + 100) as VariantId;
const item = (n: number, name: string, attributes: Record<string, string>, quantity: number, unit: number): OrderItem => ({ id: id(n) as OrderItemId, variantId: variantOf(n),
  productName: name, variantAttributes: attributes, sku: `SKU-${n}`, quantity: quantity as PositiveInteger, unitPrice: money(unit), subtotal: money(unit * quantity), mentionedPrice: null });
// Order 1042: two «Traje» lines at S/ 89.00 and «Deadpool · M» at S/ 120.00, paid S/ 150.00 with Yape.
const payment: Payment = { id: id(60) as PaymentId, orderId: id(1) as OrderId, amount: money(150), status: "confirmed", method: "digital_wallet", deductStockIfPartial: false,
  data: { confirmedAt: at, confirmedBy: { kind: "seller", userId: access.userId }, evidence: { kind: "manual" } } };
const order = (overrides: Partial<OrderAggregate> = {}): OrderAggregate => ({
  number: 1042 as OrderNumber, id: id(1) as OrderId, companyId: access.companyId, sellerId: "seller" as UserId, fromCatalog: false,
  buyer: { contactId: id(50) as ContactId, name: "Luis", phone: "+51999111222" }, checkoutEnabledAt: null, checkoutConfirmedAt: null,
  createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
  items: [item(3, "Traje", { Talla: "S" }, 1, 89), item(4, "Traje", { Talla: "M" }, 1, 89), item(5, "Deadpool", { Talla: "M" }, 1, 120)] as never,
  payments: [payment], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(298), deliveryCost: money(0), deliveryCharge: money(0), total: money(298), ...overrides,
});
const withHome = (overrides: Partial<OrderAggregate> = {}) => order({ delivery: home, deliveryCost: money(10), deliveryCharge: money(10), total: money(308), ...overrides });
const line = (n: number, quantity: number): OrderLineRequest => ({ variantId: variantOf(n), quantity: quantity as OrderLineQuantity });
const lines = (...entries: OrderLineRequest[]) => entries as unknown as EditOrderInput["items"] extends infer I ? (I extends { lines: infer L } ? L : never) : never;
const sellable = (n: number, unit: number): SellableVariant => ({ variantId: variantOf(n), productName: "Nuevo", variantAttributes: { Talla: "L" }, sku: null, unitPrice: money(unit), available: 5 });
const ratedHome = { method: "home", rateId: id(21), recipient: ana, destination: { districtCode: "150101", address: "Av. Lima 123", instructions: "Timbre roto" } } as unknown as RatedDeliverySelection;

type Stored = { current: OrderAggregate | null };
function dependencies(stored: Stored, overrides: Partial<EditOrderDependencies> = {}) {
  const writes: string[] = [];
  const saveItemChanges = vi.fn<EditOrderDependencies["saveItemChanges"]>(async () => { writes.push("items"); return ok(null); });
  const saveOrderCustomer = vi.fn<EditOrderDependencies["saveOrderCustomer"]>(async () => { writes.push("customer"); return ok(null); });
  const saveDelivery = vi.fn<EditOrderDependencies["saveDelivery"]>(async () => { writes.push("delivery"); return ok(null); });
  const publishStockEvent = vi.fn<EditOrderDependencies["publishStockEvent"]>(async () => ok({ kind: "not_due" }));
  const findSellableVariants = vi.fn<EditOrderDependencies["findSellableVariants"]>(async () => ok([sellable(3, 89), sellable(4, 89), sellable(5, 120), sellable(9, 50)]));
  const resolveRatedDelivery = vi.fn<EditOrderDependencies["resolveRatedDelivery"]>(async (_selection, _access, _currency, expectedPrice) => {
    const snapshot = parseDeliverySnapshot({ ...home, recordedBy: { kind: "seller", userId: access.userId } });
    if (!snapshot.success) throw new Error(snapshot.error.message);
    return ok({ delivery: snapshot.data, cost: expectedPrice });
  });
  const deps: EditOrderDependencies = { transaction: async (_companyId, work) => work(), findOrderForUpdate: async () => ok(stored.current),
    findSellableVariants, resolveRatedDelivery, saveItemChanges, saveOrderCustomer, saveDelivery, publishStockEvent,
    findVariantStock: async () => ok(new Map([[variantOf(3), 5n], [variantOf(4), 5n], [variantOf(5), 5n]])), newItemId: () => id(900) as OrderItemId, ...overrides };
  return { deps, writes, saveItemChanges, saveOrderCustomer, saveDelivery, publishStockEvent, findSellableVariants, resolveRatedDelivery };
}
const revisionsOf = (stored: OrderAggregate) => orderRevisions(stored);
const request = (stored: OrderAggregate, parts: Partial<Record<OrderPart, unknown>>): EditOrderInput => {
  const revisions = revisionsOf(stored);
  const input: Record<string, unknown> = { orderId: stored.id };
  for (const [part, value] of Object.entries(parts)) input[part] = { base: revisions[part as OrderPart], ...(value as object) };
  return input as EditOrderInput;
};
const replaceEdit = (price = 10): DeliveryEdit => ({ kind: "replace", selection: ratedHome, expectedPrice: money(price) });
const amendEdit: DeliveryEdit = { kind: "amend", amendment: { method: "home", recipient: { ...ana, name: "Ana Pérez" }, address: "Jr. Cusco 5", instructions: null } };
const deadpoolTwo = lines(line(3, 1), line(4, 1), line(5, 2));

test("saves items, customer and delivery together and returns the recalculated order", async () => {
  const stored = order();
  const { deps, writes } = dependencies({ current: stored });
  const result = await editOrder(request(stored, { items: { lines: deadpoolTwo }, customer: { value: { name: "Marta", phone: "+51999000111" } }, delivery: { change: replaceEdit() } }), access, deps);
  expect(result).toMatchObject({ success: true, data: { applied: ["items", "customer", "delivery"], order: { itemsTotal: money(418), deliveryCharge: money(10), total: money(428),
    buyer: { name: "Marta", phone: "+51999000111" }, delivery: { recordedBy: { kind: "seller", userId: "seller" } } } } });
  expect(writes).toEqual(["items", "customer", "delivery"]);
});

test("raises Deadpool to 2 keeping the payment and the delivery unchanged", async () => {
  const stored = withHome();
  const { deps } = dependencies({ current: stored });
  const result = await editOrder(request(stored, { items: { lines: deadpoolTwo } }), access, deps);
  expect(result).toMatchObject({ success: true, data: { order: { itemsTotal: money(418), total: money(428), payments: [payment], delivery: home } } });
});

test("answers ORDER_CHANGED naming the items when a chat message changed them since the view loaded", async () => {
  const stored = order();
  const input = request(stored, { items: { lines: deadpoolTwo } });
  const changed = order({ items: [item(3, "Traje", { Talla: "S" }, 2, 89), item(4, "Traje", { Talla: "M" }, 1, 89), item(5, "Deadpool", { Talla: "M" }, 1, 120)] as never });
  const { deps, writes } = dependencies({ current: changed });
  expect(await editOrder(input, access, deps)).toEqual(err({ code: "ORDER_CHANGED", message: expect.any(String), parts: ["items"] }));
  expect(writes).toEqual([]);
});

test("saves a customer edit even though the items revision changed", async () => {
  const loaded = order();
  const input = request(loaded, { customer: { value: null } });
  const changed = order({ items: [item(3, "Traje", { Talla: "S" }, 2, 89), item(4, "Traje", { Talla: "M" }, 1, 89), item(5, "Deadpool", { Talla: "M" }, 1, 120)] as never });
  const { deps, writes } = dependencies({ current: changed });
  expect(await editOrder(input, access, deps)).toMatchObject({ success: true, data: { applied: ["customer"], order: { buyer: { contactId: id(50), name: null, phone: null } } } });
  expect(writes).toEqual(["customer"]);
});

test("saves while a payment was voided since the view loaded", async () => {
  const loaded = order();
  const input = request(loaded, { items: { lines: deadpoolTwo } });
  const { deps } = dependencies({ current: order({ payments: [] }) });
  expect(await editOrder(input, access, deps)).toMatchObject({ success: true, data: { order: { payments: [], itemsTotal: money(418) } } });
});

test("answers ITEMS_LOCKED and writes nothing when stock was deducted since the view loaded", async () => {
  const loaded = order();
  const input = request(loaded, { items: { lines: deadpoolTwo } });
  const { deps, writes } = dependencies({ current: order({ stockDeducted: true, stockDeductedAt: at }) });
  expect(await editOrder(input, access, deps)).toMatchObject({ success: false, error: { code: "ITEMS_LOCKED" } });
  expect(writes).toEqual([]);
});

test("refuses clearing the customer of a buyer-confirmed order and writes nothing", async () => {
  const confirmed = order({ checkoutEnabledAt: at, checkoutConfirmedAt: at });
  const { deps, writes, publishStockEvent } = dependencies({ current: confirmed });
  expect(await editOrder(request(confirmed, { customer: { value: null } }), access, deps)).toMatchObject({ success: false, error: { code: "CUSTOMER_REQUIRED" } });
  expect(writes).toEqual([]);
  expect(publishStockEvent).not.toHaveBeenCalled();
});

test("refuses the whole edit when it clears the customer of a buyer-confirmed order, even with other parts", async () => {
  const confirmed = order({ checkoutEnabledAt: at, checkoutConfirmedAt: at });
  const { deps, writes } = dependencies({ current: confirmed });
  expect(await editOrder(request(confirmed, { items: { lines: deadpoolTwo }, customer: { value: null } }), access, deps)).toMatchObject({ success: false, error: { code: "CUSTOMER_REQUIRED" } });
  expect(writes).toEqual([]);
});

test("changes the customer of a buyer-confirmed order to another customer", async () => {
  const confirmed = order({ checkoutEnabledAt: at, checkoutConfirmedAt: at });
  const { deps, writes } = dependencies({ current: confirmed });
  expect(await editOrder(request(confirmed, { customer: { value: { name: "Marta", phone: "+51999000111" } } }), access, deps))
    .toMatchObject({ success: true, data: { applied: ["customer"], order: { buyer: { name: "Marta", phone: "+51999000111" } } } });
  expect(writes).toEqual(["customer"]);
});

test("saves only the customer of a shipped order", async () => {
  const loaded = order();
  const shipped = order({ deliveryStatus: "shipped", shippedAt: at, stockDeducted: true, stockDeductedAt: at });
  const { deps, publishStockEvent, writes } = dependencies({ current: shipped });
  expect(await editOrder(request(loaded, { customer: { value: { name: "Marta", phone: "+51999000111" } } }), access, deps)).toMatchObject({ success: true, data: { applied: ["customer"] } });
  expect(await editOrder(request(loaded, { items: { lines: deadpoolTwo } }), access, deps)).toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
  expect(writes).toEqual(["customer"]);
  expect(publishStockEvent).not.toHaveBeenCalled();
});

test("answers VARIANT_NOT_FOUND for a new variant that is no longer sellable and writes nothing", async () => {
  const stored = order();
  const { deps, writes } = dependencies({ current: stored }, { findSellableVariants: async () => ok([]) });
  expect(await editOrder(request(stored, { items: { lines: lines(line(3, 1), line(9, 1)) } }), access, deps))
    .toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: variantOf(9) } });
  expect(writes).toEqual([]);
});

test("answers TOTAL_CHANGED with the current price when a replaced delivery was requoted", async () => {
  const stored = order();
  const changed = { code: "TOTAL_CHANGED" as const, message: "Price changed", currentPrice: money(12) };
  const { deps, writes } = dependencies({ current: stored }, { resolveRatedDelivery: async () => err(changed as never) });
  expect(await editOrder(request(stored, { delivery: { change: replaceEdit(10) } }), access, deps)).toEqual(err(changed));
  expect(writes).toEqual([]);
});

test("does not quote an amended delivery", async () => {
  const stored = withHome();
  const { deps, resolveRatedDelivery } = dependencies({ current: stored });
  const result = await editOrder(request(stored, { delivery: { change: amendEdit } }), access, deps);
  expect(result).toMatchObject({ success: true, data: { applied: ["delivery"], order: { deliveryCost: money(10), deliveryCharge: money(10), total: money(308),
    delivery: { recipient: { name: "Ana Pérez" }, recordedBy: { kind: "seller" } } } } });
  expect(resolveRatedDelivery).not.toHaveBeenCalled();
});

test("publishes order_edited once when items and delivery change", async () => {
  const stored = order();
  const { deps, publishStockEvent } = dependencies({ current: stored });
  await editOrder(request(stored, { items: { lines: deadpoolTwo }, delivery: { change: replaceEdit() } }), access, deps);
  expect(publishStockEvent).toHaveBeenCalledTimes(1);
  expect(publishStockEvent).toHaveBeenCalledWith({ companyId: access.companyId, orderId: stored.id });
});

test("publishes nothing for a customer-only edit", async () => {
  const stored = order();
  const { deps, publishStockEvent } = dependencies({ current: stored });
  await editOrder(request(stored, { customer: { value: null } }), access, deps);
  expect(publishStockEvent).not.toHaveBeenCalled();
});

test("returns the order deducted when the edit covers the total and stock fits", async () => {
  const stored = order();
  const deductedAt = new Date("2026-09-29T13:00:00Z");
  const { deps } = dependencies({ current: stored }, { publishStockEvent: async () => ok({ kind: "deducted", stock: new Map(), deductedAt }) });
  const result = await editOrder(request(stored, { items: { lines: lines(line(5, 1)) } }), access, deps);
  expect(result).toMatchObject({ success: true, data: { order: { stockDeducted: true, stockDeductedAt: deductedAt, total: money(120) }, stockDue: null } });
});

test("returns the order waiting when the edit covers the total and stock is short", async () => {
  const stored = order();
  const shortItems = [{ variantId: variantOf(5), required: 1, available: 0 }] as never;
  const { deps } = dependencies({ current: stored }, { publishStockEvent: async () => ok({ kind: "short", shortItems }) });
  expect(await editOrder(request(stored, { items: { lines: lines(line(5, 1)) } }), access, deps))
    .toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: { kind: "waiting" } } });
});

test("never changes, voids or removes a payment", async () => {
  const stored = order();
  const { deps, saveItemChanges } = dependencies({ current: stored });
  const result = await editOrder(request(stored, { items: { lines: lines(line(5, 1)) } }), access, deps);
  expect(result).toMatchObject({ success: true, data: { order: { payments: [payment] } } });
  expect(saveItemChanges.mock.calls[0]?.[0].payments).toEqual([payment]);
});

test("succeeds without writes when the same final state is sent twice", async () => {
  const stored = order();
  const input = request(stored, { items: { lines: deadpoolTwo } });
  const first = await editOrder(input, access, dependencies({ current: stored }).deps);
  if (!first.success) throw new Error("Expected the first save");
  const second = dependencies({ current: first.data.order });
  expect(await editOrder(input, access, second.deps)).toMatchObject({ success: true, data: { applied: [], order: { itemsTotal: money(418) } } });
  expect(second.writes).toEqual([]);
  expect(second.publishStockEvent).not.toHaveBeenCalled();
});

test("succeeds without writes when the repeated edit had deducted the stock", async () => {
  const stored = order();
  const input = request(stored, { items: { lines: deadpoolTwo } });
  const first = await editOrder(input, access, dependencies({ current: stored }).deps);
  if (!first.success) throw new Error("Expected the first save");
  const deducted = { ...first.data.order, stockDeducted: true, stockDeductedAt: at, deliveryStatus: "shipped" as const, shippedAt: at };
  const second = dependencies({ current: deducted });
  expect(await editOrder(input, access, second.deps)).toMatchObject({ success: true, data: { applied: [] } });
  expect(second.writes).toEqual([]);
});

test("refuses a request without parts and a missing or foreign order", async () => {
  const { deps } = dependencies({ current: null });
  expect(await editOrder({ orderId: id(1) as OrderId }, access, deps)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  const stored = order();
  expect(await editOrder(request(stored, { customer: { value: null } }), access, deps)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
});
