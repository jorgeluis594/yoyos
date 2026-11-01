import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createCompleteOrder, type CreateCompleteOrderDependencies, type CreateCompleteOrderInput } from "@core/src/features/orders/application/create-complete-order";
import { createOrder } from "@core/src/features/orders/application/create-order";
import { buildPendingOrder } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { companyId: id(1) as CompanyId, userId: "seller" as UserId };
const input: CreateCompleteOrderInput = { id: id(2) as OrderId, 
  items: [{ variantId: id(3) as VariantId, quantity: 1 as PositiveInteger }] };
const payment = { paymentId: id(4) as PaymentId, amount: { amount: 10, currency: "PEN" as const }, method: "digital_wallet" as const, deductStockIfPartial: false };

function fixture() {
  const built = buildPendingOrder({ ...input, number: 1001 as OrderNumber, companyId: context.companyId, sellerId: context.userId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-06T12:00:00Z"),
    items: [{ ...input.items[0], id: id(5) as OrderItemId, productName: "Product", sku: null, variantAttributes: {}, unitPrice: payment.amount }] });
  if (!built.success) throw new Error("Invalid fixture");
  const order = built.data;
  const create = vi.fn(async (selection: Parameters<typeof createOrder>[0]) => createOrder(selection, context, {
    transaction: async (_companyId, work) => work(), orderExists: async () => ok(false), 
    findVariants: async () => ok([order.items[0]]), allocateNumber: async () => ok(order.number),
    saveOrder: async () => ok(null), newItemId: () => order.items[0].id, clock: () => order.createdAt }));
  const registerPayment = vi.fn(async (): Promise<Awaited<ReturnType<CreateCompleteOrderDependencies["registerPayment"]>>> =>
    ok({ order, stockDue: null, outcome: { kind: "not_due" } }));
  const deliver = vi.fn(async () => ok(order));
  const transaction = vi.fn();
  const deps: CreateCompleteOrderDependencies = { transaction: async (_companyId, work) => { transaction(); return work(); }, create,
    setDelivery: async () => ok({ order }), registerPayment, ship: async () => ok(order), deliver };
  return { deps, transaction, create, registerPayment, deliver, order };
}

test("optional creation data does not turn a pending order into an immediate sale", async () => {
  const f = fixture();
  expect(await createCompleteOrder({ ...input, payments: [], deliverImmediately: false }, context, f.deps)).toEqual(ok({ order: f.order, stockDue: null }));
  expect(f.registerPayment).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
});

test("rejects duplicate payment identities before creating the order", async () => {
  const f = fixture();
  expect(await createCompleteOrder({ ...input, payments: [payment, payment] }, context, f.deps)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(f.create).not.toHaveBeenCalled();
});

test("delivery failure prevents payments and fulfillment", async () => {
  const f = fixture();
  const failure = err({ code: "DELIVERY_UNAVAILABLE" as const, message: "Unavailable" });
  expect(await createCompleteOrder({ ...input, payments: [payment], deliverImmediately: true,
    delivery: { delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } } },
  context, { ...f.deps, setDelivery: async () => failure })).toEqual(failure);
  expect(f.registerPayment).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
});

test("initial delivery without a reviewed price is rejected before opening a transaction", async () => {
  const f = fixture();
  const delivery = { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } };
  for (const selection of [{ delivery }, { delivery, price: { amount: 0, currency: "PEN" } }]) {
    expect(await createCompleteOrder({ ...input, payments: [payment], delivery: selection } as unknown as CreateCompleteOrderInput, context, f.deps))
      .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  }
  expect(f.transaction).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
  expect(f.registerPayment).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
});

const paidWith = (f: ReturnType<typeof fixture>, outcome: DeductionOutcome, stockDue: Awaited<ReturnType<typeof f.registerPayment>> extends infer R ? R extends { success: true; data: { stockDue: infer S } } ? S : never : never = null) =>
  f.registerPayment.mockResolvedValue(ok({ order: f.order, stockDue, outcome }));
const waiting = (variantId: string) => ({ kind: "waiting" as const, shortItems: [{ variantId: variantId as VariantId, available: 0 as never }] as const });

test("creates an order with covering payments and short stock as waiting", async () => {
  const f = fixture();
  const variantId = f.order.items[0].variantId;
  paidWith(f, { kind: "short", shortItems: [{ variantId, available: 0 as never }] }, waiting(variantId));
  expect(await createCompleteOrder({ ...input, payments: [payment] }, context, f.deps)).toEqual(ok({ order: f.order, stockDue: waiting(variantId) }));
  expect(f.deliver).not.toHaveBeenCalled();
});

test("refuses delivering immediately with short stock, names the short variant and persists nothing", async () => {
  const f = fixture();
  const variantId = f.order.items[0].variantId;
  paidWith(f, { kind: "short", shortItems: [{ variantId, available: 0 as never }] }, waiting(variantId));
  expect(await createCompleteOrder({ ...input, payments: [payment], deliverImmediately: true }, context, f.deps))
    .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId } });
  expect(f.deliver).not.toHaveBeenCalled();
});

test("delivers immediately on save with a partial payment and no stock-deduction request", async () => {
  const f = fixture();
  const partial = { ...payment, amount: { amount: 4, currency: "PEN" as const } };
  expect(await createCompleteOrder({ ...input, payments: [partial], deliverImmediately: true }, context, f.deps)).toEqual(ok({ order: f.order, stockDue: null }));
  expect(f.registerPayment).toHaveBeenCalledTimes(1);
  expect(f.deliver).toHaveBeenCalledTimes(1);
});

test("answers a data fault while delivering immediately as INVALID_STORED_DATA, never as insufficient stock", async () => {
  const f = fixture();
  paidWith(f, { kind: "failed", stage: "lock_stock", errorCode: "INVALID_STORED_DATA" });
  expect(await createCompleteOrder({ ...input, payments: [payment], deliverImmediately: true }, context, f.deps))
    .toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  paidWith(f, { kind: "failed", stage: "deduct_stock", errorCode: "UNEXPECTED_ROW_COUNT" });
  expect(await createCompleteOrder({ ...input, payments: [payment], deliverImmediately: true }, context, f.deps))
    .toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
});

test("answers a contended deduction while delivering immediately as PERSISTENCE_UNAVAILABLE", async () => {
  const f = fixture();
  paidWith(f, { kind: "failed", stage: "lock_stock", errorCode: "LOCK_TIMEOUT" });
  expect(await createCompleteOrder({ ...input, payments: [payment], deliverImmediately: true }, context, f.deps))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});

test("ignores the old deferral option", async () => {
  const f = fixture();
  const result = await createCompleteOrder({ ...input, payments: [payment], deferStockDeduction: true } as unknown as CreateCompleteOrderInput, context, f.deps);
  expect(result.success).toBe(true);
  expect(f.registerPayment).toHaveBeenCalledWith(expect.not.objectContaining({ deferStockDeduction: expect.anything() }), context);
});
