import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { cancelOrder, type CancelOrderDependencies } from "@core/src/features/orders/application/cancel-order";
import { buildPendingOrder, type CancelledOrder } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const orderId = id(2) as OrderId;
const context = { companyId, userId: "seller" as UserId };
function pendingOrder() {
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: orderId, companyId, sellerId: context.userId, customer: { kind: "general_public" },
    createdAt: new Date("2026-09-29T12:00:00Z"), items: [{ id: id(4) as OrderItemId, variantId: id(5) as VariantId,
      productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error("Invalid test order");
  return built.data;
}


function dependencies(order = pendingOrder()) {
  let committed = false;
  let saved = 0;
  const events: unknown[] = [];
  const deps: CancelOrderDependencies = {
    transaction: async (_company, work) => { const result = await work(); committed = result.success; return result; },
    findOrderForUpdate: async () => ok(order),
    saveCancellation: async () => { saved++; return ok(null); },
    publishOrderCancelled: async payload => { expect(committed).toBe(true); events.push(payload); return ok(undefined); },
  };
  return { deps, events, saved: () => saved };
}

test.each([false, true])("publishes once after commit while retaining stock %s", async stockDeducted => {
  const order = { ...pendingOrder(), stockDeducted };
  const f = dependencies(order);
  const result = await cancelOrder(orderId, context, f.deps);
  expect(result).toMatchObject({ success: true, data: { cancelled: true, deliveryStatus: "pending", deliveredAt: null, completedAt: null, stockDeducted } });
  expect(f.events).toEqual([{ orderId, companyId }]);
  expect(f.saved()).toBe(1);
  if (!result.success) throw new Error("Expected cancellation");
  expect(result.data.items).toEqual(order.items);
  expect(result.data.payments).toEqual(order.payments);
  const repeated = dependencies(result.data);
  expect(await cancelOrder(orderId, context, repeated.deps)).toEqual(result);
  expect(repeated.events).toEqual([]);
  expect(repeated.saved()).toBe(0);
});

test.each(["load", "save", "commit", "missing"] as const)("does not publish after %s failure", async stage => {
  const f = dependencies();
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unavailable" });
  const deps: CancelOrderDependencies = { ...f.deps,
    findOrderForUpdate: async () => stage === "load" ? failure : ok(stage === "missing" ? null : pendingOrder()),
    saveCancellation: async () => stage === "save" ? failure : ok(null),
    transaction: async (_company, work) => { const result = await work(); return stage === "commit" ? failure : result; },
  };
  expect(await cancelOrder(orderId, context, deps)).toMatchObject({ success: false, error: { code: stage === "missing" ? "ORDER_NOT_FOUND" : "PERSISTENCE_UNAVAILABLE" } });
  expect(f.events).toEqual([]);
});

test("returns the committed cancellation after a publication failure", async () => {
  const f = dependencies();
  expect(await cancelOrder(orderId, context, { ...f.deps,
    publishOrderCancelled: async () => err({ code: "EVENT_BUS_UNAVAILABLE", message: "Unavailable" }),
  })).toMatchObject({ success: true, data: { cancelled: true } });
});

test("cancelled result narrows dates and state without forcing stock restoration", () => {
  const cancelled: CancelledOrder = { ...pendingOrder(), cancelled: true, deliveryStatus: "pending", deliveredAt: null, completedAt: null };
  const waiting: CancelledOrder = { ...cancelled, stockDeducted: true };
  // @ts-expect-error Cancellation cannot describe a dispatched order.
  const invalid: CancelledOrder = { ...cancelled, deliveryStatus: "shipped" };
  // @ts-expect-error Cancellation must preserve the cancellation fact.
  const active: CancelledOrder = { ...cancelled, cancelled: false };
  // @ts-expect-error Cancellation cannot have a delivery date.
  const delivered: CancelledOrder = { ...cancelled, deliveredAt: new Date() };
  expect(waiting.stockDeducted).toBe(true);
  void [invalid, active, delivered];
});
