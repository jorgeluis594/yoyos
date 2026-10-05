import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { buildPendingOrder, type DeliverySelection, type OrderAggregate, type Payment } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { setOrderDelivery, type SetDeliveryDependencies } from "@core/src/features/orders/application/set-delivery";
import { resolveDeliverySelection } from "@core/src/features/orders/application/resolve-delivery-selection";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { companyId: id(1) as CompanyId, userId: "seller" as UserId };
const delivery = { method: "store" as const, recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" as const } } };
const point = { name: "Tienda", address: "Av. Lima 123", instructions: null };
const money = (amount: number) => ({ amount, currency: "PEN" as const });
function order(): OrderAggregate {
  const result = buildPendingOrder({ id: id(2) as OrderId, companyId: context.companyId, sellerId: "creator" as UserId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-01"), items: [{ id: id(3) as OrderItemId,
      variantId: id(4) as VariantId, productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: money(10) }] });
  if (!result.success) throw new Error("Invalid fixture");
  return result.data;
}
const payment = (amount: number): Payment => ({ id: id(5) as PaymentId, orderId: id(2) as OrderId,
  amount: money(amount), method: "digital_wallet", recordedAt: new Date("2026-10-02") });
function dependencies(current: OrderAggregate | null, amount = 3) {
  const saveDelivery = vi.fn<SetDeliveryDependencies["saveDelivery"]>(async () => ok(null));
  const deductProductStock = vi.fn<SetDeliveryDependencies["deductProductStock"]>(async () => ok(null));
  const saveStockDeduction = vi.fn<SetDeliveryDependencies["saveStockDeduction"]>(async () => ok(null));
  const resolveDelivery = vi.fn<SetDeliveryDependencies["resolveDelivery"]>((selection, access, currency) => resolveDeliverySelection(selection, access, currency, {
    getSettings: async () => ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: point } }), resolveCost: async () => ok(money(amount)),
  }));
  const deps: SetDeliveryDependencies = { transaction: async (_companyId, work) => work(),
    findOrderForUpdate: async () => ok(current), resolveDelivery, saveDelivery, deductProductStock, saveStockDeduction };
  return { deps, saveDelivery, deductProductStock, saveStockDeduction, resolveDelivery };
}
const input = { orderId: id(2) as OrderId, delivery, chargeDeliveryToCustomer: true };

test("assigns and replaces the current snapshot with seller authorship and a complete aggregate", async () => {
  const initial = order();
  const first = await setOrderDelivery(input, context, dependencies(initial).deps);
  expect(first).toMatchObject({ success: true, data: { delivery: { method: "store", pickupPoint: point,
    recordedBy: { kind: "seller", userId: context.userId } }, deliveryCost: money(3), deliveryCharge: money(3), total: money(13),
    payments: [], stockDeducted: false } });
  if (!first.success) throw new Error("Expected assigned delivery");
  const second = await setOrderDelivery({ ...input, chargeDeliveryToCustomer: false }, { ...context, userId: "second-seller" as UserId }, dependencies(first.data, 2).deps);
  expect(second).toMatchObject({ success: true, data: { delivery: { recordedBy: { kind: "seller", userId: "second-seller" } },
    deliveryCost: money(2), deliveryCharge: money(0), total: money(10) } });
  expect(initial.delivery).toBeNull();
  expect(first.data.delivery?.recordedBy).toEqual({ kind: "seller", userId: "seller" });
});

test("rejects missing, cancelled and fulfilled orders before resolving delivery", async () => {
  for (const [current, code] of [
    [null, "ORDER_NOT_FOUND"], [{ ...order(), cancelled: true }, "ORDER_CANCELLED"],
    [{ ...order(), payments: [payment(10)], stockDeducted: true, deliveryStatus: "shipped" as const }, "DELIVERY_LOCKED"],
    [{ ...order(), payments: [payment(10)], stockDeducted: true, deliveryStatus: "delivered" as const, completedAt: new Date("2026-10-03") }, "DELIVERY_LOCKED"],
  ] as const) {
    const f = dependencies(current);
    expect(await setOrderDelivery(input, context, f.deps)).toMatchObject({ success: false, error: { code } });
    expect(f.resolveDelivery).not.toHaveBeenCalled();
    expect(f.saveDelivery).not.toHaveBeenCalled();
    expect(f.deductProductStock).not.toHaveBeenCalled();
  }
});

test.each([9, 10, 12])("deducts missing stock only when the new total is covered by existing payment of %s", async (paid) => {
  const current = { ...order(), payments: [payment(paid)] };
  const f = dependencies(current);
  const result = await setOrderDelivery({ ...input, chargeDeliveryToCustomer: false }, context, f.deps);
  expect(result).toMatchObject({ success: true, data: { stockDeducted: paid >= 10, payments: current.payments } });
  expect(f.deductProductStock).toHaveBeenCalledTimes(paid >= 10 ? 1 : 0);
  expect(f.saveStockDeduction).toHaveBeenCalledTimes(paid >= 10 ? 1 : 0);
  const deducted = dependencies({ ...current, stockDeducted: true });
  expect((await setOrderDelivery({ ...input, chargeDeliveryToCustomer: false }, context, deducted.deps)).success).toBe(true);
  expect(deducted.deductProductStock).not.toHaveBeenCalled();
});

test("failed resolution and forged authority leave all writes untouched", async () => {
  const f = dependencies(order());
  const failure = err({ code: "DELIVERY_UNAVAILABLE" as const, message: "No resolver integrated" });
  f.resolveDelivery.mockResolvedValue(failure);
  expect(await setOrderDelivery(input, context, f.deps)).toEqual(failure);
  const forged = { ...delivery, recordedBy: { kind: "buyer" } };
  expect(await setOrderDelivery({ ...input, delivery: forged as DeliverySelection }, context, f.deps))
    .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(f.saveDelivery).not.toHaveBeenCalled();
  expect(f.deductProductStock).not.toHaveBeenCalled();
});
