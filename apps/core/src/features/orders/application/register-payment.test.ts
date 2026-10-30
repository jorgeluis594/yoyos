import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import type { Payment } from "@core/src/features/orders/domain/order-state-machine";
import { registerPayment, type RegisterPaymentDependencies } from "@core/src/features/orders/application/register-payment";
import { buildPendingOrder } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const orderId = id(2) as OrderId;
const context = { companyId, userId: "seller" as UserId };
const input = { orderId, paymentId: id(3) as PaymentId, amount: { amount: 10, currency: "PEN" as const },
  method: "digital_wallet" as const, deductStockIfPartial: false };

function pendingOrder() {
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: orderId, companyId, sellerId: context.userId, customer: { kind: "general_public" },
    createdAt: new Date("2026-09-29T12:00:00Z"), items: [{ id: id(4) as OrderItemId, variantId: id(5) as VariantId,
      productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error("Invalid test order");
  return built.data;
}

const variantId = id(5) as VariantId;

function fixture(outcome: DeductionOutcome, initial = pendingOrder(), stock: unknown = 3n) {
  const events: unknown[] = [];
  const saved: Payment[] = [];
  const order: string[] = [];
  const deps: RegisterPaymentDependencies = {
    transaction: async (_company, work) => work(),
    findOrderForUpdate: async () => ok(initial),
    savePayment: async (payment) => { saved.push(payment); order.push("save"); return ok(null); },
    updatePayment: async () => { throw new Error("Manual payment must be created"); },
    saveCompletion: async () => { throw new Error("Undelivered order cannot be completed"); },
    publishPaymentConfirmed: async (event) => { events.push(event); order.push("publish"); return ok(outcome); },
    findVariantStock: async () => ok(new Map([[variantId, stock]])),
    clock: () => new Date("2026-09-30T12:00:00Z"),
  };
  return { deps, events, saved, order };
}

test("records a covering payment with short stock and returns the waiting order", async () => {
  const f = fixture({ kind: "short", shortItems: [{ variantId, available: 0 as never }] });
  expect(await registerPayment(input, context, f.deps)).toMatchObject({ success: true,
    data: { order: { stockDeducted: false, payments: [{ id: input.paymentId }] }, stockDue: { kind: "waiting", shortItems: [{ variantId, available: 0 }] } } });
  expect(f.order).toEqual(["save", "publish"]);
  expect(f.events).toEqual([{ companyId, orderId, paymentId: input.paymentId }]);
});

test("records a covering payment with enough stock and returns the deducted order", async () => {
  const f = fixture({ kind: "deducted", stock: new Map(), deductedAt: new Date("2026-09-30T12:00:00Z") });
  expect(await registerPayment(input, context, f.deps)).toMatchObject({ success: true, data: { order: { stockDeducted: true }, stockDue: null } });
});

test("records the payment when the deduction fails with invalid stock data", async () => {
  const f = fixture({ kind: "failed", stage: "lock_stock", errorCode: "INVALID_STORED_DATA" }, pendingOrder(), -4n);
  expect(await registerPayment(input, context, f.deps)).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: { kind: "deducting" } } });
  const contended = fixture({ kind: "failed", stage: "lock_stock", errorCode: "LOCK_TIMEOUT" }, pendingOrder(), 5n);
  expect(await registerPayment(input, context, contended.deps)).toMatchObject({ success: true, data: { stockDue: { kind: "deducting" } } });
  const short = fixture({ kind: "failed", stage: "deduct_stock", errorCode: "DEADLOCK" }, pendingOrder(), 0n);
  expect(await registerPayment(input, context, short.deps)).toMatchObject({ success: true, data: { stockDue: { kind: "waiting", shortItems: [{ available: 0 }] } } });
});

test("stores the partial deduction request on the confirmation", async () => {
  const f = fixture({ kind: "not_due" });
  await registerPayment({ ...input, deductStockIfPartial: true }, context, f.deps);
  expect(f.saved[0]).toMatchObject({ status: "confirmed", deductStockIfPartial: true });
  const plain = fixture({ kind: "not_due" });
  await registerPayment(input, context, plain.deps);
  expect(plain.saved[0]).toMatchObject({ deductStockIfPartial: false });
});

test("a transaction-ending failure of the deduction fails the whole payment", async () => {
  const f = fixture({ kind: "not_due" });
  const ending = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "closed", transactionEnding: true as const };
  expect(await registerPayment(input, context, { ...f.deps, publishPaymentConfirmed: async () => ({ success: false, error: ending }) }))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});

test("a repeated approval publishes nothing and returns the current order", async () => {
  const first = fixture({ kind: "not_due" });
  const created = await registerPayment(input, context, first.deps);
  if (!created.success) throw new Error("setup");
  const replay = fixture({ kind: "not_due" }, { ...created.data.order, stockDeducted: false });
  expect(await registerPayment(input, context, replay.deps)).toMatchObject({ success: true, data: { order: { payments: [{ id: input.paymentId }] }, stockDue: { kind: "deducting" } } });
  expect(replay.events).toEqual([]);
  expect(replay.saved).toEqual([]);
});
