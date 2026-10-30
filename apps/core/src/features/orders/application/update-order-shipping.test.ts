import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { DispatchDate } from "@shared/dispatch-date";
import { updateOrderShipping, type UpdateOrderShippingDependencies } from "@core/src/features/orders/application/update-order-shipping";
import { buildPendingOrder, orderStateMachine, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { confirmPayment } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const orderId = id(2) as OrderId;
const context = { companyId, userId: "seller" as UserId };
const now = new Date("2026-10-14T15:00:00Z");
const date = (value: string) => value as DispatchDate;

function pendingOrder(): OrderAggregate {
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: orderId, companyId, sellerId: context.userId, customer: { kind: "general_public" },
    createdAt: new Date("2026-09-29T12:00:00Z"), items: [{ id: id(4) as OrderItemId, variantId: id(5) as VariantId,
      productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error("Invalid test order");
  return built.data;
}
function readyOrder(): OrderAggregate {
  const order = pendingOrder();
  const payment = confirmPayment({ id: id(6) as PaymentId, orderId, source: "manual", amount: order.total, method: "digital_wallet", confirmedBy: context.userId, confirmedAt: now }, null);
  if (!payment.success) throw new Error("Invalid test payment");
  const paid = orderStateMachine.registerPayment(order, payment.data);
  if (!paid.success) throw new Error("Invalid test payment");
  return { ...paid.data, stockDeducted: true, stockDeductedAt: new Date("2026-10-01T00:00:00Z") };
}

function setup(order: OrderAggregate, failFulfillment = false) {
  let stored = order;
  let committed: OrderAggregate | null = null;
  const deps: UpdateOrderShippingDependencies = {
    transaction: async (_company, work) => { const before = stored; const result = await work(); if (result.success) committed = stored; else stored = before; return result; },
    findOrderForUpdate: async () => ok(stored),
    saveDispatchSchedule: async (_id, _company, change) => { stored = { ...stored, ...change }; return ok(null); },
    saveFulfillment: async (_id, _company, change) => failFulfillment ? err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) : (stored = { ...stored, ...change }, ok(null)),
    deductProductStock: async () => ok(null), saveStockDeduction: async () => ok(null),
    clock: () => now,
  };
  return { deps, stored: () => stored, committed: () => committed };
}

test("reschedules and clears the date while pending", async () => {
  const f = setup(pendingOrder());
  expect(await updateOrderShipping({ orderId, scheduledDispatchDate: date("2020-01-01") }, context, f.deps)).toMatchObject({ success: true, data: { scheduledDispatchDate: "2020-01-01" } });
  expect(await updateOrderShipping({ orderId, scheduledDispatchDate: null }, context, f.deps)).toMatchObject({ success: true, data: { scheduledDispatchDate: null } });
});

test("rejects scheduling a cancelled order", async () => {
  const f = setup({ ...pendingOrder(), cancelled: true, cancelledAt: new Date("2026-10-01T00:00:00Z") });
  expect(await updateOrderShipping({ orderId, scheduledDispatchDate: date("2026-10-15") }, context, f.deps)).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
});

test("shipping stamps shippedAt once and repeating keeps it", async () => {
  const f = setup(readyOrder());
  const shipped = await updateOrderShipping({ orderId, status: "shipped" }, context, f.deps);
  expect(shipped).toMatchObject({ success: true, data: { deliveryStatus: "shipped", shippedAt: now } });
  const again = setup({ ...readyOrder(), deliveryStatus: "shipped", shippedAt: new Date("2026-10-13T10:00:00Z") });
  expect(await updateOrderShipping({ orderId, status: "shipped" }, context, again.deps)).toMatchObject({ success: true, data: { shippedAt: new Date("2026-10-13T10:00:00Z") } });
});

test("pending to delivered leaves shippedAt empty", async () => {
  const f = setup(readyOrder());
  expect(await updateOrderShipping({ orderId, status: "delivered" }, context, f.deps)).toMatchObject({ success: true, data: { deliveryStatus: "delivered", shippedAt: null, deliveredAt: now } });
});

test("a failed transition rolls back the schedule", async () => {
  const f = setup(readyOrder(), true);
  const result = await updateOrderShipping({ orderId, scheduledDispatchDate: date("2026-10-20"), status: "shipped" }, context, f.deps);
  expect(result.success).toBe(false);
  expect(f.stored().scheduledDispatchDate).toBeNull();
  expect(f.committed()).toBeNull();
});

test("cannot schedule after dispatch", async () => {
  const f = setup({ ...readyOrder(), deliveryStatus: "shipped", shippedAt: now });
  expect(await updateOrderShipping({ orderId, scheduledDispatchDate: date("2026-10-20") }, context, f.deps)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
});
