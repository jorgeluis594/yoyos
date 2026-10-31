import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderLineQuantity, OrderLineRequest } from "@core/src/features/orders/domain/order-edit";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";
import { planItemsEdit, settleEditStock, writeItemsEdit, type ItemsEditRecords } from "@core/src/features/orders/application/apply-items-edit";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const variantOf = (n: number) => id(n + 100) as VariantId;
const item = (n: number, quantity: number, deducted = 0): OrderItem => ({ id: id(n) as OrderItemId, variantId: variantOf(n), productName: `P${n}`, variantAttributes: {}, sku: null,
  quantity: quantity as PositiveInteger, unitPrice: money(10), subtotal: money(10 * quantity), mentionedPrice: null, stockDeductedQuantity: deducted });
const order = (items: readonly OrderItem[], overrides: Partial<OrderAggregate> = {}): OrderAggregate => ({ number: 1042 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId,
  sellerId: "seller" as UserId, fromCatalog: false, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null,
  completedAt: null, cancelled: false, cancelledAt: null, items: items as never, payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(items.reduce((sum, entry) => sum + entry.subtotal.amount, 0)), deliveryCost: money(0), deliveryCharge: money(0),
  total: money(items.reduce((sum, entry) => sum + entry.subtotal.amount, 0)), ...overrides });
const line = (n: number, quantity: number): OrderLineRequest => ({ variantId: variantOf(n), quantity: quantity as OrderLineQuantity });
const sellable = (n: number): SellableVariant => ({ variantId: variantOf(n), productName: `P${n}`, variantAttributes: {}, sku: null, unitPrice: money(10), available: 9 });
const planDeps = () => ({ findSellableVariants: vi.fn(async () => ok([sellable(3), sellable(4), sellable(9)])), newItemId: () => id(900) as OrderItemId });

test("plans an edit reading the deducted units of the deleted lines and writing nothing", async () => {
  const stored = order([item(3, 2, 2), item(4, 1, 1)], { stockDeducted: true, stockDeductedAt: at });
  const deps = planDeps();
  const planned = await planItemsEdit(stored, [line(3, 1)], deps);
  expect(planned).toMatchObject({ success: true, data: { returns: [{ variantId: variantOf(4), quantity: 1 }],
    changes: { updated: [{ id: id(3), quantity: 1 }], removedItemIds: [id(4)], added: [] }, order: { itemsTotal: money(10) } } });
  expect(deps.findSellableVariants).not.toHaveBeenCalled();
});

test("plans an added variant with the current catalog price after looking it up once", async () => {
  const deps = planDeps();
  const planned = await planItemsEdit(order([item(3, 1)]), [line(3, 1), line(9, 2)], deps);
  expect(deps.findSellableVariants).toHaveBeenCalledWith([variantOf(9)]);
  expect(planned).toMatchObject({ success: true, data: { changes: { added: [{ id: id(900), quantity: 2 }] } } });
});

test("refuses a plan with a variant that is no longer sellable", async () => {
  const deps = { ...planDeps(), findSellableVariants: vi.fn(async () => ok<readonly SellableVariant[]>([])) };
  expect(await planItemsEdit(order([item(3, 1)]), [line(3, 1), line(9, 1)], deps)).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: variantOf(9) } });
});

const recordsOf = () => {
  const calls: string[] = [];
  const records: ItemsEditRecords = {
    saveItemChanges: vi.fn(async () => { calls.push("items"); return ok(null); }),
    setVerdictsForEdit: vi.fn(async () => { calls.push("verdicts"); return ok(null); }),
    saveSellerActedAt: vi.fn(async () => { calls.push("acted"); return ok(null); }),
    clock: () => at,
  };
  return { calls, records };
};

test("writes the lines, gives quantity_changed and removed to the edited items' changes and records the seller's action", async () => {
  const stored = order([item(3, 2), item(4, 1), item(5, 1)]);
  const planned = await planItemsEdit(stored, [line(3, 3), line(5, 1)], planDeps());
  if (!planned.success) throw new Error("plan failed");
  const { calls, records } = recordsOf();
  expect(await writeItemsEdit(stored, planned.data, records)).toEqual(ok(null));
  expect(calls).toEqual(["items", "verdicts", "acted"]);
  expect(records.setVerdictsForEdit).toHaveBeenCalledWith(stored.id, stored.companyId, [{ verdict: "quantity_changed", itemIds: [id(3)] }, { verdict: "removed", itemIds: [id(4)] }], at);
  expect(records.saveSellerActedAt).toHaveBeenCalledWith(stored.id, stored.companyId, at);
});

test("sets no verdict for an edit that only adds lines", async () => {
  const stored = order([item(3, 1)]);
  const planned = await planItemsEdit(stored, [line(3, 1), line(9, 1)], planDeps());
  if (!planned.success) throw new Error("plan failed");
  const { calls, records } = recordsOf();
  await writeItemsEdit(stored, planned.data, records);
  expect(calls).toEqual(["items", "acted"]);
});

test("stops at the first write that fails", async () => {
  const stored = order([item(3, 2), item(4, 1)]);
  const planned = await planItemsEdit(stored, [line(3, 1)], planDeps());
  if (!planned.success) throw new Error("plan failed");
  const { records } = recordsOf();
  const failing = { ...records, saveItemChanges: vi.fn(async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" })) };
  expect(await writeItemsEdit(stored, planned.data, failing)).toMatchObject({ success: false });
  expect(records.setVerdictsForEdit).not.toHaveBeenCalled();
});

const stockDeps = () => ({ publishStockEvent: vi.fn(async () => ok({ kind: "not_due" as const })), publishStockIncreased: vi.fn(async () => ok(null)),
  findVariantStock: async () => ok(new Map<VariantId, bigint>()) });

test("settles the stock with one order_edited carrying the returns, then serves waiting orders", async () => {
  const before = order([item(3, 2, 2), item(4, 1, 1)], { stockDeducted: true, stockDeductedAt: at });
  const after = order([item(3, 2, 2)], { stockDeducted: true, stockDeductedAt: at });
  const deps = stockDeps();
  deps.publishStockEvent.mockResolvedValue(ok({ kind: "adjusted", returnedUnits: 1, deductedUnits: 0, pending: [], deductedByVariant: new Map(), returnedVariantIds: [variantOf(4)] } as never));
  const result = await settleEditStock(before, after, { items: true, delivery: false }, [{ variantId: variantOf(4), quantity: 1 as PositiveInteger }], deps);
  expect(result.success).toBe(true);
  expect(deps.publishStockEvent).toHaveBeenCalledTimes(1);
  expect(deps.publishStockEvent).toHaveBeenCalledWith({ companyId: before.companyId, orderId: before.id, returns: [{ variantId: variantOf(4), quantity: 1 }] });
  expect(deps.publishStockIncreased).toHaveBeenCalledWith([variantOf(4)]);
});

test("rolls a deducted order back when the listener failed", async () => {
  const stored = order([item(3, 1, 1)], { stockDeducted: true, stockDeductedAt: at });
  const deps = stockDeps();
  deps.publishStockEvent.mockResolvedValue(ok({ kind: "failed", stage: "deduct_stock", errorCode: "X" } as never));
  expect(await settleEditStock(stored, stored, { items: true, delivery: false }, [], deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});

test("publishes nothing for a delivery-only edit of a deducted order and describes its stock", async () => {
  const stored = order([item(3, 1, 1)], { stockDeducted: true, stockDeductedAt: at });
  const deps = stockDeps();
  const result = await settleEditStock(stored, stored, { items: false, delivery: true }, [], deps);
  expect(deps.publishStockEvent).not.toHaveBeenCalled();
  expect(result).toMatchObject({ success: true, data: { outcome: null } });
});
