import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { rejectPendingCatalogOrder } from "@core/src/features/orders/application/reject-pending-catalog-order";
import { cancelOrder } from "@core/src/features/orders/application/cancel-order";
import { getOrderAggregate } from "@core/src/features/orders/application/read-order-aggregate";
import { buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const orderId = id(2) as OrderId;
const context = { companyId, userId: "seller" as UserId };
function catalogOrder(checkoutConfirmedAt: Date | null): OrderAggregate {
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: orderId, companyId, sellerId: null, customer: { kind: "general_public" },
    createdAt: new Date("2026-10-17T12:00:00Z"), items: [{ id: id(4) as OrderItemId, variantId: id(5) as VariantId,
      productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error("Invalid test order");
  return { ...built.data, fromCatalog: true, checkoutEnabledAt: new Date("2026-10-17T12:00:00Z"), checkoutConfirmedAt };
}
const reader = (order: OrderAggregate) => rejectPendingCatalogOrder(async (...args: [OrderId, CompanyId]) => (void args, ok(order)));

test("seller use cases treat an unconfirmed catalog order as not found", async () => {
  const pending = reader(catalogOrder(null));
  expect(await getOrderAggregate(orderId, context, pending)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
  expect(await cancelOrder(orderId, context, { transaction: (_company, work) => work(), findOrderForUpdate: pending,
    saveCancellation: async () => { throw new Error("must not save"); }, publishOrderCancelled: async () => { throw new Error("must not publish"); } }))
    .toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });

  const confirmed = catalogOrder(new Date("2026-10-17T12:05:00Z"));
  expect(await getOrderAggregate(orderId, context, reader(confirmed))).toEqual({ success: true, data: confirmed });
});
