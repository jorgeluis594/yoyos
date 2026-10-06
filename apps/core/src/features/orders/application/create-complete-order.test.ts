import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createCompleteOrder, type CreateCompleteOrderDependencies, type CreateCompleteOrderInput } from "@core/src/features/orders/application/create-complete-order";
import { createOrder } from "@core/src/features/orders/application/create-order";
import { buildPendingOrder } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { companyId: id(1) as CompanyId, userId: "seller" as UserId };
const input: CreateCompleteOrderInput = { id: id(2) as OrderId, contactId: null,
  items: [{ variantId: id(3) as VariantId, quantity: 1 as PositiveInteger }] };
const payment = { paymentId: id(4) as PaymentId, amount: { amount: 10, currency: "PEN" as const }, method: "digital_wallet" as const, deductStockIfPartial: false };

function fixture() {
  const built = buildPendingOrder({ ...input, number: 1001 as OrderNumber, companyId: context.companyId, sellerId: context.userId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-06T12:00:00Z"),
    items: [{ ...input.items[0], id: id(5) as OrderItemId, productName: "Product", sku: null, variantAttributes: {}, unitPrice: payment.amount }] });
  if (!built.success) throw new Error("Invalid fixture");
  const order = built.data;
  const create = vi.fn(async (selection: Parameters<typeof createOrder>[0]) => createOrder(selection, context, {
    transaction: async (_companyId, work) => work(), orderExists: async () => ok(false), findContact: async () => ok(null),
    findVariant: async () => ok(order.items[0]), allocateNumber: async () => ok(order.number),
    saveOrder: async () => ok(null), newItemId: () => order.items[0].id, clock: () => order.createdAt }));
  const registerPayment = vi.fn(async () => ok({ order, stock: { kind: "not_requested" as const } }));
  const deliver = vi.fn(async () => ok(order));
  const deps: CreateCompleteOrderDependencies = { transaction: async (_companyId, work) => work(), create,
    setDelivery: async () => ok(order), registerPayment, deliver };
  return { deps, create, registerPayment, deliver, order };
}

test("optional creation data does not turn a pending order into an immediate sale", async () => {
  const f = fixture();
  expect(await createCompleteOrder({ ...input, payments: [], deliverImmediately: false }, context, f.deps)).toEqual(ok(f.order));
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
    delivery: { delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, chargeDeliveryToCustomer: true } },
  context, { ...f.deps, setDelivery: async () => failure })).toEqual(failure);
  expect(f.registerPayment).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
});
