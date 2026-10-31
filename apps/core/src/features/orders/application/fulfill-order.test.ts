import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { deductPendingStock, deliverOrder, pendingStockLines, type FulfillOrderDependencies } from "@core/src/features/orders/application/fulfill-order";
import { buildPendingOrder, orderStateMachine, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { confirmPayment } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-10-14T15:00:00Z");
const variantA = id(5) as VariantId;
const variantB = id(6) as VariantId;

/** An order of 3 × A and 2 × B whose stock was deducted, except for the units given as already taken out. */
function deductedOrder(deducted: readonly [number, number]): OrderAggregate {
  const line = (n: number, variantId: VariantId, quantity: number) => ({ id: id(n) as OrderItemId, variantId, productName: "Item", variantAttributes: {}, sku: null, quantity, unitPrice: { amount: 10, currency: "PEN" as const } });
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: id(2) as OrderId, companyId: id(1) as CompanyId, sellerId: "seller" as UserId, customer: { kind: "general_public" },
    createdAt: new Date("2026-09-29T12:00:00Z"), items: [line(3, variantA, 3), line(4, variantB, 2)] });
  if (!built.success) throw new Error("Invalid test order");
  const [first, second] = built.data.items;
  return { ...built.data, stockDeducted: true, stockDeductedAt: at, items: [{ ...first, stockDeductedQuantity: deducted[0] }, { ...second!, stockDeductedQuantity: deducted[1] }] } as OrderAggregate;
}

function setup(stock: ReadonlyMap<VariantId, number>, bulkResult?: number) {
  const calls = { lock: vi.fn(), deduct: vi.fn(), save: vi.fn() };
  const deps = {
    lockVariantStock: async (variantIds: readonly VariantId[]) => { calls.lock(variantIds); return ok(new Map([...stock].filter(([variant]) => variantIds.includes(variant)))); },
    deductStockBulk: async (lines: readonly unknown[]) => { calls.deduct(lines); return ok(bulkResult ?? lines.length); },
    saveStockDeduction: async () => { calls.save(); return ok(null); },
  } as unknown as FulfillOrderDependencies;
  return { deps, calls };
}

test("pendingStockLines lists only what each line still lacks", () => {
  expect(pendingStockLines(deductedOrder([3, 2]))).toEqual([]);
  expect(pendingStockLines(deductedOrder([1, 2]))).toEqual([{ variantId: variantA, quantity: 2 }]);
  expect(pendingStockLines(deductedOrder([0, 0]))).toEqual([{ variantId: variantA, quantity: 3 }, { variantId: variantB, quantity: 2 }]);
});

test("deductPendingStock takes only the pending part when it fits", async () => {
  const f = setup(new Map([[variantA, 2], [variantB, 0]]));
  expect(await deductPendingStock(deductedOrder([1, 2]), at, f.deps)).toEqual(ok(null));
  expect(f.calls.deduct).toHaveBeenCalledWith([{ variantId: variantA, quantity: 2 }]);
  expect(f.calls.save).toHaveBeenCalledTimes(1);
});

test("deductPendingStock answers INSUFFICIENT_STOCK and persists nothing when the pending part is short", async () => {
  const f = setup(new Map([[variantA, 1], [variantB, 5]]));
  expect(await deductPendingStock(deductedOrder([1, 2]), at, f.deps)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: variantA } });
  expect(f.calls.deduct).not.toHaveBeenCalled();
  expect(f.calls.save).not.toHaveBeenCalled();
});

test("deductPendingStock answers INSUFFICIENT_STOCK when the guarded statement takes fewer lines than asked", async () => {
  const f = setup(new Map([[variantA, 5]]), 0);
  expect(await deductPendingStock(deductedOrder([1, 2]), at, f.deps)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
  expect(f.calls.save).not.toHaveBeenCalled();
});

test("deductPendingStock runs no stock statement when nothing is pending", async () => {
  const f = setup(new Map());
  expect(await deductPendingStock(deductedOrder([3, 2]), at, f.deps)).toEqual(ok(null));
  expect(f.calls.lock).not.toHaveBeenCalled();
  expect(f.calls.deduct).not.toHaveBeenCalled();
  expect(f.calls.save).not.toHaveBeenCalled();
});

function paidOrder(deducted: readonly [number, number]): OrderAggregate {
  const order = deductedOrder(deducted);
  const payment = confirmPayment({ id: id(7) as PaymentId, orderId: order.id, source: "manual", amount: order.total, method: "digital_wallet", deductStockIfPartial: false, confirmedBy: "seller" as UserId, confirmedAt: at }, null);
  if (!payment.success) throw new Error("Invalid test payment");
  const paid = orderStateMachine.registerPayment(order, payment.data);
  if (!paid.success) throw new Error("Invalid test payment");
  return paid.data;
}

test("deliverOrder takes the pending part before delivering", async () => {
  const f = setup(new Map([[variantA, 2]]));
  expect(await deliverOrder(paidOrder([1, 2]), at, f.deps)).toMatchObject({ success: true, data: { deliveryStatus: "delivered" } });
  expect(f.calls.deduct).toHaveBeenCalledWith([{ variantId: variantA, quantity: 2 }]);
});

test("deliverOrder fails with INSUFFICIENT_STOCK when the pending part is short and deducts nothing", async () => {
  const f = setup(new Map([[variantA, 1]]));
  expect(await deliverOrder(paidOrder([1, 2]), at, f.deps)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
  expect(f.calls.deduct).not.toHaveBeenCalled();
});
