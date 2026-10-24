import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { rejectPayment, type RejectPaymentDependencies } from "@core/src/features/orders/application/reject-payment";
import { buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ImageId } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const orderId = id(2) as OrderId;
const paymentId = id(3) as PaymentId;
const context = { companyId, userId: "seller" as UserId };
const reportedAt = new Date("2026-09-29T13:00:00Z");

function orderWithReport(): OrderAggregate {
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: orderId, companyId, sellerId: context.userId, customer: { kind: "general_public" },
    createdAt: new Date("2026-09-29T12:00:00Z"), items: [{ id: id(4) as OrderItemId, variantId: id(5) as VariantId,
      productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error("Invalid test order");
  return { ...built.data, payments: [{ id: paymentId, orderId, status: "reported", currency: "PEN", amount: null, method: null,
    data: { receiptImageId: id(6) as ImageId, reportedAt } }] };
}

function dependencies(order: OrderAggregate | null, saved: unknown[] = []): RejectPaymentDependencies & { transactions: number } {
  const deps = {
    transactions: 0,
    transaction: async (_company: CompanyId, work: () => Promise<never>) => { deps.transactions++; return work(); },
    findOrderForUpdate: async () => ok(order),
    updatePayment: async (payment: unknown, _company: CompanyId, expected: string) => { saved.push({ payment, expected }); return ok(null); },
    clock: () => new Date("2026-09-30T12:00:00Z"),
  };
  return deps as unknown as RejectPaymentDependencies & { transactions: number };
}

test("rejects a pending report inside the order transaction", async () => {
  const saved: unknown[] = [];
  const deps = dependencies(orderWithReport(), saved);
  const result = await rejectPayment({ orderId, paymentId, reason: " El monto no coincide " }, context, deps);
  expect(result).toMatchObject({ success: true, data: { applied: true, order: { payments: [{ id: paymentId, status: "rejected",
    data: { reason: "El monto no coincide", rejectedBy: "seller", rejectedAt: new Date("2026-09-30T12:00:00Z") } }] } } });
  expect(saved).toMatchObject([{ payment: { status: "rejected" }, expected: "reported" }]);
  expect(deps.transactions).toBe(1);
});

test("returns not found for a payment outside the order", async () => {
  expect(await rejectPayment({ orderId, paymentId: id(9) as PaymentId, reason: null }, context, dependencies(orderWithReport())))
    .toMatchObject({ success: false, error: { code: "PAYMENT_NOT_FOUND" } });
  expect(await rejectPayment({ orderId, paymentId, reason: null }, context, dependencies(null)))
    .toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
});

test("replays a repeated rejection without writing", async () => {
  const first = await rejectPayment({ orderId, paymentId, reason: "Primero" }, context, dependencies(orderWithReport()));
  if (!first.success) throw new Error("Expected rejection");
  const saved: unknown[] = [];
  const replay = await rejectPayment({ orderId, paymentId, reason: "Otro" }, context, dependencies(first.data.order, saved));
  expect(replay).toMatchObject({ success: true, data: { applied: false, order: { payments: [{ data: { reason: "Primero" } }] } } });
  expect(saved).toEqual([]);
});

test("replays a rejection even when the retry carries a reason longer than 200 characters", async () => {
  const first = await rejectPayment({ orderId, paymentId, reason: null }, context, dependencies(orderWithReport()));
  if (!first.success) throw new Error("Expected rejection");
  expect(await rejectPayment({ orderId, paymentId, reason: "a".repeat(201) }, context, dependencies(first.data.order)))
    .toMatchObject({ success: true, data: { applied: false } });
  expect(await rejectPayment({ orderId, paymentId, reason: "a".repeat(201) }, context, dependencies(orderWithReport())))
    .toMatchObject({ success: false, error: { code: "INVALID_PAYMENT" } });
});
