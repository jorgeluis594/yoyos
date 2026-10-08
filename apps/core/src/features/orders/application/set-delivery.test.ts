import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { buildPendingOrder, parseDeliverySnapshot, parseRatedDeliverySelection, type RatedDeliverySelection, type OrderAggregate, type Payment } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { DeliverySettingsVersion } from "@core/src/features/delivery-settings";
import type { VariantId } from "@core/src/features/products/domain/product";
import { setOrderDelivery, type SetDeliveryDependencies } from "@core/src/features/orders/application/set-delivery";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { companyId: id(1) as CompanyId, userId: "seller" as UserId };
const delivery = { method: "store" as const, recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" as const } } };
const point = { name: "Tienda", address: "Av. Lima 123", instructions: null };
const parsedHome = parseRatedDeliverySelection({ method: "home", rateId: id(6), recipient: delivery.recipient,
  destination: { districtCode: "150122", address: "Street", instructions: null } });
if (!parsedHome.success) throw new Error("Invalid rated fixture");
const home = parsedHome.data;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
function order(): OrderAggregate {
  const result = buildPendingOrder({ number: 1001 as OrderNumber, id: id(2) as OrderId, companyId: context.companyId, sellerId: "creator" as UserId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-01"), items: [{ id: id(3) as OrderItemId,
      variantId: id(4) as VariantId, productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: money(10) }] });
  if (!result.success) throw new Error("Invalid fixture");
  return result.data;
}
const payment = (amount: number): Payment => ({ id: id(5) as PaymentId, orderId: id(2) as OrderId,
  amount: money(amount), status: "confirmed", method: "digital_wallet", data: { confirmedAt: new Date("2026-10-02"), confirmedBy: { kind: "seller", userId: context.userId }, evidence: { kind: "manual" } } });
function dependencies(current: OrderAggregate | null, amount = 3) {
  const saveDelivery = vi.fn<SetDeliveryDependencies["saveDelivery"]>(async () => ok(null));
  const deductProductStock = vi.fn<SetDeliveryDependencies["deductProductStock"]>(async () => ok(null));
  const saveStockDeduction = vi.fn<SetDeliveryDependencies["saveStockDeduction"]>(async () => ok(null));
  const resolveDelivery = vi.fn<SetDeliveryDependencies["resolveDelivery"]>(async () => err({ code: "INTERNAL_ERROR", message: "Unexpected legacy selection" }));
  const resolveRatedDelivery = vi.fn<SetDeliveryDependencies["resolveRatedDelivery"]>(async (selection, access) => {
    if (selection.method !== "home") throw new Error("Expected home selection");
    const { rateId, ...details } = selection;
    const snapshot = parseDeliverySnapshot({ ...details,
      destination: { ...selection.destination, country: "PE", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" },
      pricing: { rateId, quotationId: id(7), zoneId: id(8), settingsVersion: 1 },
      recordedBy: { kind: "seller", userId: access.userId } });
    if (!snapshot.success) throw new Error(snapshot.error.message);
    return ok({ delivery: snapshot.data, cost: money(amount) });
  });
  const deps: SetDeliveryDependencies = { resolveRatedDelivery, transaction: async (_companyId, work) => work(),
    findOrderForUpdate: async () => ok(current), resolveDelivery, saveDelivery, deductProductStock, saveStockDeduction };
  return { deps, saveDelivery, deductProductStock, saveStockDeduction, resolveDelivery, resolveRatedDelivery };
}
const input = { orderId: id(2) as OrderId, delivery: home, expectedPrice: money(3) };

test("assigns and replaces the current snapshot with seller authorship and a complete aggregate", async () => {
  const initial = order();
  const first = await setOrderDelivery(input, context, dependencies(initial).deps);
  expect(first).toMatchObject({ success: true, data: { delivery: { method: "home", pricing: { rateId: id(6) },
    recordedBy: { kind: "seller", userId: context.userId } }, deliveryCost: money(3), deliveryCharge: money(3), total: money(13),
    payments: [], stockDeducted: false } });
  if (!first.success) throw new Error("Expected assigned delivery");
  const replacement = parseRatedDeliverySelection({ ...home, rateId: id(9) });
  if (!replacement.success) throw new Error("Invalid replacement fixture");
  const second = await setOrderDelivery({ ...input, delivery: replacement.data, expectedPrice: money(2) }, { ...context, userId: "second-seller" as UserId }, dependencies(first.data, 2).deps);
  expect(second).toMatchObject({ success: true, data: { delivery: { pricing: { rateId: id(9) }, recordedBy: { kind: "seller", userId: "second-seller" } },
    deliveryCost: money(2), deliveryCharge: money(2), total: money(12) } });
  expect(initial.delivery).toBeNull();
  expect(first.data.delivery?.recordedBy).toEqual({ kind: "seller", userId: "seller" });
});

test("rejects missing, cancelled and fulfilled orders before resolving delivery", async () => {
  for (const [current, code] of [
    [null, "ORDER_NOT_FOUND"], [{ ...order(), cancelled: true }, "ORDER_CANCELLED"],
    [{ ...order(), payments: [payment(10)], stockDeducted: true, deliveryStatus: "shipped" as const }, "DELIVERY_LOCKED"],
    [{ ...order(), payments: [payment(10)], stockDeducted: true, deliveredAt: new Date("2026-10-02"), deliveryStatus: "delivered" as const, completedAt: new Date("2026-10-03") }, "DELIVERY_LOCKED"],
  ] as const) {
    const f = dependencies(current);
    expect(await setOrderDelivery(input, context, f.deps)).toMatchObject({ success: false, error: { code } });
    expect(f.resolveDelivery).not.toHaveBeenCalled();
    expect(f.resolveRatedDelivery).not.toHaveBeenCalled();
    expect(f.saveDelivery).not.toHaveBeenCalled();
    expect(f.deductProductStock).not.toHaveBeenCalled();
  }
});

test.each([12, 13, 15])("deducts missing stock only when the new total is covered by existing payment of %s", async (paid) => {
  const current = { ...order(), payments: [payment(paid)] };
  const f = dependencies(current);
  const result = await setOrderDelivery(input, context, f.deps);
  expect(result).toMatchObject({ success: true, data: { stockDeducted: paid >= 13, payments: current.payments } });
  expect(f.deductProductStock).toHaveBeenCalledTimes(paid >= 13 ? 1 : 0);
  expect(f.saveStockDeduction).toHaveBeenCalledTimes(paid >= 13 ? 1 : 0);
  const deducted = dependencies({ ...current, stockDeducted: true });
  expect((await setOrderDelivery(input, context, deducted.deps)).success).toBe(true);
  expect(deducted.deductProductStock).not.toHaveBeenCalled();
});

test("failed resolution and forged authority leave all writes untouched", async () => {
  const f = dependencies(order());
  const failure = err({ code: "DELIVERY_UNAVAILABLE" as const, message: "No resolver integrated" });
  f.resolveRatedDelivery.mockResolvedValue(failure);
  expect(await setOrderDelivery(input, context, f.deps)).toEqual(failure);
  const forged = { ...home, recordedBy: { kind: "buyer" } };
  expect(await setOrderDelivery({ ...input, delivery: forged as RatedDeliverySelection }, context, f.deps))
    .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(f.saveDelivery).not.toHaveBeenCalled();
  expect(f.deductProductStock).not.toHaveBeenCalled();
});

test("rated assignments charge the validated price and reuse covered-stock deduction without a client charge flag", async () => {
  const f = dependencies({ ...order(), payments: [payment(10)] });
  const resolveRatedDelivery = vi.fn<SetDeliveryDependencies['resolveRatedDelivery']>(async () => ok({
    delivery: { ...delivery, pickupPoint: point, settingsVersion: 2 as DeliverySettingsVersion,
      recordedBy: { kind: 'seller', userId: context.userId } }, cost: money(0),
  }));
  const rated = { orderId: input.orderId, delivery, expectedPrice: money(0) };
  expect(await setOrderDelivery(rated, context, { ...f.deps, resolveRatedDelivery })).toMatchObject({ success: true, data: {
    stockDeducted: true, deliveryCost: money(0), deliveryCharge: money(0), total: money(10),
  } });
  expect(resolveRatedDelivery).toHaveBeenCalledWith(delivery, context, 'PEN', money(0));
  expect(f.resolveDelivery).not.toHaveBeenCalled();
  expect(f.deductProductStock).toHaveBeenCalledTimes(1);
  const rejected = dependencies(order());
  expect(await setOrderDelivery({ ...rated, chargeDeliveryToCustomer: false }, context, rejected.deps))
    .toMatchObject({ success: false, error: { code: 'INVALID_ORDER' } });
  expect(rejected.saveDelivery).not.toHaveBeenCalled();
});

test("rated price conflicts never save delivery, stock or totals", async () => {
  const f = dependencies({ ...order(), payments: [payment(10)] });
  const failure = err({ code: 'TOTAL_CHANGED' as const, currentPrice: money(8), message: 'Review price' });
  expect(await setOrderDelivery({ orderId: input.orderId, delivery, expectedPrice: money(0) }, context,
    { ...f.deps, resolveRatedDelivery: async () => failure })).toEqual(failure);
  expect(f.saveDelivery).not.toHaveBeenCalled();
  expect(f.deductProductStock).not.toHaveBeenCalled();
  expect(f.saveStockDeduction).not.toHaveBeenCalled();
});
