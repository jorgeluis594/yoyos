import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { registerPayment, type RegisterPaymentDependencies } from "@core/src/features/orders/application/register-payment";
import { buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
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

test("returns pending stock after a known second-transaction failure without losing the payment", async () => {
  let current = pendingOrder();
  let transactions = 0;
  const transaction: RegisterPaymentDependencies["transaction"] = async (_company, work) => {
    transactions++;
    return transactions === 2 ? err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database unavailable" }) : work();
  };
  const deps: RegisterPaymentDependencies = { transaction, findOrderForUpdate: async () => ok(current),
    savePayment: async (payment) => { current = { ...current, payments: [payment] }; return ok(null); },
    deductProductStock: async () => { throw new Error("Stock should not be called"); },
    saveStockDeduction: async () => { throw new Error("Flag should not be saved"); },
    clock: () => new Date("2026-09-30T12:00:00Z") };
  expect(await registerPayment(input, context, deps)).toMatchObject({ success: true,
    data: { order: { payments: [{ id: input.paymentId }] }, stock: { kind: "pending", reason: "PERSISTENCE_UNAVAILABLE" } } });
  expect(transactions).toBe(2);
  expect(current.payments).toHaveLength(1);
});

test("reports cancellation that interleaves after payment recording", async () => {
  let current: OrderAggregate = pendingOrder();
  let transactions = 0;
  const transaction: RegisterPaymentDependencies["transaction"] = async (_company, work) => {
    transactions++;
    if (transactions === 2) current = { ...current, cancelled: true };
    return work();
  };
  const deps: RegisterPaymentDependencies = { transaction, findOrderForUpdate: async () => ok(current),
    savePayment: async (payment) => { current = { ...current, payments: [payment] }; return ok(null); },
    deductProductStock: async () => { throw new Error("Cancelled order must not deduct stock"); },
    saveStockDeduction: async () => { throw new Error("Cancelled order must not mark stock"); },
    clock: () => new Date("2026-09-30T12:00:00Z") };
  expect(await registerPayment(input, context, deps)).toMatchObject({ success: true,
    data: { order: { cancelled: true, payments: [{ id: input.paymentId }] }, stock: { kind: "inapplicable", reason: "ORDER_CANCELLED" } } });
});
