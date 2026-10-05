import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
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
  const built = buildPendingOrder({ id: orderId, companyId, sellerId: context.userId, customer: { kind: "general_public" },
    createdAt: new Date("2026-09-29T12:00:00Z"), items: [{ id: id(4) as OrderItemId, variantId: id(5) as VariantId,
      productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error("Invalid test order");
  return built.data;
}

test("confirms payment and required stock in one transaction", async () => {
  let transactions = 0;
  let paymentSaved = false;
  let stockSaved = false;
  const deps: RegisterPaymentDependencies = {
    transaction: async (_company, work) => { transactions++; return work(); },
    findOrderForUpdate: async () => ok(pendingOrder()),
    savePayment: async () => { paymentSaved = true; return ok(null); },
    deductProductStock: async () => paymentSaved ? ok(null) : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Payment missing" }),
    saveStockDeduction: async () => { stockSaved = true; return ok(null); },
    clock: () => new Date("2026-09-30T12:00:00Z"),
  };
  expect(await registerPayment(input, context, deps)).toMatchObject({ success: true,
    data: { order: { stockDeducted: true, payments: [{ id: input.paymentId }] }, stock: { kind: "deducted" } } });
  expect({ transactions, paymentSaved, stockSaved }).toEqual({ transactions: 1, paymentSaved: true, stockSaved: true });
});

test("returns stock failure instead of claiming a confirmed payment", async () => {
  let transactions = 0;
  const deps: RegisterPaymentDependencies = {
    transaction: async (_company, work) => { transactions++; return work(); },
    findOrderForUpdate: async () => ok(pendingOrder()),
    savePayment: async () => ok(null),
    deductProductStock: async () => err({ code: "INSUFFICIENT_STOCK", message: "Stock unavailable" }),
    saveStockDeduction: async () => { throw new Error("Stock flag must not be saved"); },
    clock: () => new Date("2026-09-30T12:00:00Z"),
  };
  expect(await registerPayment(input, context, deps)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
  expect(transactions).toBe(1);
});
