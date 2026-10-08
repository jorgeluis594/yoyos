import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { describe, expect, test } from "vitest";
import { buildPendingOrder, orderStateMachine, type OrderAggregate, type DeliverySnapshot, type CourierId } from "@core/src/features/orders/domain/order-state-machine";
import type { ConfirmedPayment } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const createdAt = new Date("2026-09-29T12:00:00Z");
const paymentAt = new Date("2026-09-30T12:00:00Z");
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const order = (): OrderAggregate => ({
  number: 1001 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId,
  buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt, deliveredAt: null, completedAt: null, cancelled: false,
  items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Item", variantAttributes: {}, sku: null,
    quantity: 1 as PositiveInteger, unitPrice: money(10), subtotal: money(10) }],
  payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false,
  itemsTotal: money(10), deliveryCost: money(0), deliveryCharge: money(0), total: money(10),
});
const payment = (n: number, amount: number): ConfirmedPayment => ({ id: id(n) as PaymentId, orderId: id(1) as OrderId,
  status: "confirmed", amount: money(amount), method: "digital_wallet",
  data: { confirmedAt: paymentAt, confirmedBy: { kind: "seller", userId: "seller" as UserId }, evidence: { kind: "manual" } } });
const home: DeliverySnapshot = { method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
  destination: { address: "Av. Lima 123", district: "Lima", instructions: null }, recordedBy: { kind: "seller", userId: "seller" as UserId } };

describe("pending order construction", () => {
  test("preserves identity and snapshots while leaving payment, delivery and stock pending", () => {
    const input = { number: 1001 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId,
      customer: { kind: "general_public" as const }, createdAt,
      items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Item", variantAttributes: { Size: "M" },
        sku: null, quantity: 3, unitPrice: money(0.1) }] };
    const built = buildPendingOrder(input);
    expect(built).toMatchObject({ success: true, data: { id: id(1), createdAt, deliveredAt: null, completedAt: null, cancelled: false,
      payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false,
      itemsTotal: money(0.3), deliveryCost: money(0), deliveryCharge: money(0), total: money(0.3),
      items: [{ subtotal: money(0.3), variantAttributes: { Size: "M" } }] } });
    if (!built.success) return;
    input.items[0].variantAttributes.Size = "L";
    expect(built.data.items[0].variantAttributes).toEqual({ Size: "M" });
    expect(orderStateMachine.getLifecycle(built.data)).toEqual({ success: true, data: { status: "active", completedAt: null } });
  });

  test("rejects empty, repeated, invalidly priced and mixed currency items", () => {
    const input = { number: 1001 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId,
      customer: { kind: "general_public" as const }, createdAt,
      items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Item", variantAttributes: {},
        sku: null, quantity: 1, unitPrice: money(10) }] };
    expect(buildPendingOrder({ ...input, items: [] })).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(buildPendingOrder({ ...input, items: [input.items[0], input.items[0]] })).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(buildPendingOrder({ ...input, items: [{ ...input.items[0], unitPrice: money(0.001) }] }))
      .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(buildPendingOrder({ ...input, items: [input.items[0], { ...input.items[0], id: id(5) as OrderItemId,
      variantId: id(6) as VariantId, unitPrice: { amount: 1, currency: "USD" as const } }] }))
      .toMatchObject({ success: false, error: { code: "CURRENCY_MISMATCH" } });
  });
});

describe("order payment and lifecycle", () => {
  test("derives pending, covered and excess amounts without changing the order", () => {
    const initial = order();
    expect(orderStateMachine.getPaymentSummary(initial)).toMatchObject({ success: true, data: {
      status: "pending", paidAmount: money(0), balanceDue: money(10), overpaidAmount: money(0) } });
    const paid = orderStateMachine.registerPayment(initial, payment(5, 10));
    expect(paid).toMatchObject({ success: true });
    if (!paid.success) return;
    expect(orderStateMachine.getPaymentSummary(paid.data)).toMatchObject({ success: true, data: {
      status: "paid", paidAmount: money(10), balanceDue: money(0), overpaidAmount: money(0) } });
    expect(orderStateMachine.getLifecycle(paid.data)).toEqual({ success: true, data: { status: "active", completedAt: null } });
    const excess = orderStateMachine.registerPayment(paid.data, payment(6, 0.25));
    expect(excess).toMatchObject({ success: true });
    if (!excess.success) return;
    expect(orderStateMachine.getPaymentSummary(excess.data)).toMatchObject({ success: true, data: {
      status: "paid", paidAmount: money(10.25), balanceDue: money(0), overpaidAmount: money(0.25) } });
    expect(initial.payments).toEqual([]);
  });

  test("recognizes the same payment ID and rejects different data or invalid amounts", () => {
    const paid = orderStateMachine.registerPayment(order(), payment(5, 4));
    if (!paid.success) throw new Error("Expected payment");
    expect(orderStateMachine.registerPayment(paid.data, { ...payment(5, 4), data: { ...payment(5, 4).data, confirmedAt: new Date("2026-10-01") } }))
      .toEqual({ success: true, data: paid.data });
    expect(orderStateMachine.registerPayment(paid.data, payment(5, 5))).toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
    expect(orderStateMachine.registerPayment(order(), payment(5, 0.001))).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT" } });
    expect(orderStateMachine.registerPayment(order(), { ...payment(5, 1), amount: { amount: 1, currency: "USD" } }))
      .toMatchObject({ success: false, error: { code: "CURRENCY_MISMATCH" } });
  });

  test("preserves an existing completion date when another payment is recorded", () => {
    const completed = { ...order(), payments: [payment(5, 10)], stockDeducted: true,
      deliveryStatus: "delivered" as const, deliveredAt: createdAt, completedAt: createdAt };
    expect(orderStateMachine.registerPayment(completed, payment(6, 1))).toMatchObject({ success: true,
      data: { completedAt: createdAt, payments: [{ id: id(5) }, { id: id(6) }] } });
  });

  test("rejects accumulated payments outside the supported range", () => {
    const enormous = { ...order(), itemsTotal: money(9_999_999_999_999.99), total: money(9_999_999_999_999.99) };
    const first = orderStateMachine.registerPayment(enormous, payment(5, 9_999_999_999_999.99));
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(orderStateMachine.registerPayment(first.data, payment(6, 0.01))).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT" } });
  });
});

describe("delivery and stock transitions", () => {
  test("replaces delivery cost and charge while retaining payments and item prices", () => {
    const initial = orderStateMachine.registerPayment(order(), payment(5, 10));
    if (!initial.success) throw new Error("Expected payment");
    const free = orderStateMachine.setDelivery(initial.data, { resolved: { delivery: home, cost: money(0) } });
    expect(free).toMatchObject({ success: true, data: { deliveryCost: money(0), deliveryCharge: money(0), total: money(10) } });
    if (!free.success) return;
    const charged = orderStateMachine.setDelivery(free.data, { resolved: { delivery: home, cost: money(2) } });
    expect(charged).toMatchObject({ success: true, data: { deliveryCost: money(2), deliveryCharge: money(2), total: money(12) } });
    if (!charged.success) return;
    expect(orderStateMachine.getPaymentSummary(charged.data)).toMatchObject({ success: true, data: { status: "pending", balanceDue: money(2) } });
    expect(charged.data.items).toBe(initial.data.items);
    expect(charged.data.payments).toBe(initial.data.payments);
  });

  test("requires documented agency recipient and validates identity at runtime", () => {
    const invalid = { method: "agency", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, courier: { id: id(8) as CourierId, name: "Courier" }, agency: "Lima", recordedBy: { kind: "seller", userId: "seller" as UserId } };
    expect(orderStateMachine.setDelivery(order(), { resolved: { delivery: invalid as DeliverySnapshot, cost: money(1) } }))
      .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    const agency: DeliverySnapshot = { method: "agency", recipient: { name: "Ana", phone: "999", identity: {
      kind: "document", documentType: "passport", document: "A-001" } }, courier: { id: id(8) as CourierId, name: "Courier" }, agency: "Lima", recordedBy: { kind: "seller", userId: "seller" as UserId } };
    expect(orderStateMachine.setDelivery(order(), { resolved: { delivery: agency, cost: money(0) } }))
      .toMatchObject({ success: true, data: { delivery: agency } });
  });

  test("deducts only when requested for partial payment, automatically when covered, and only once", () => {
    const partial = orderStateMachine.registerPayment(order(), payment(5, 4));
    if (!partial.success) throw new Error("Expected payment");
    expect(orderStateMachine.planStockDeduction(partial.data, false)).toMatchObject({ success: true, data: { kind: "none", reason: "not_requested" } });
    const requested = orderStateMachine.planStockDeduction(partial.data, true);
    expect(requested).toMatchObject({ success: true, data: { kind: "deduct", nextOrder: { stockDeducted: true } } });
    if (!requested.success) return;
    expect(partial.data.stockDeducted).toBe(false);
    expect(orderStateMachine.planStockDeduction(requested.data.nextOrder, true)).toMatchObject({ success: true, data: { kind: "none", reason: "already_deducted" } });
    const covered = orderStateMachine.registerPayment(partial.data, payment(6, 6));
    if (!covered.success) throw new Error("Expected payment");
    expect(orderStateMachine.planStockDeduction(covered.data, false)).toMatchObject({ success: true, data: { kind: "deduct" } });
  });

  test("requires payment and stock, then ships and completes at the supplied time", () => {
    expect(orderStateMachine.registerShipment(order())).toMatchObject({ success: false, error: { code: "PAYMENT_REQUIRED" } });
    const paid = orderStateMachine.registerPayment(order(), payment(5, 10));
    if (!paid.success) throw new Error("Expected payment");
    expect(orderStateMachine.registerDelivery(paid.data, paymentAt)).toMatchObject({ success: false, error: { code: "STOCK_NOT_DEDUCTED" } });
    const deducted = orderStateMachine.planStockDeduction(paid.data, false);
    if (!deducted.success) throw new Error("Expected deduction plan");
    const shipped = orderStateMachine.registerShipment(deducted.data.nextOrder);
    expect(shipped).toMatchObject({ success: true, data: { deliveryStatus: "shipped", completedAt: null } });
    if (!shipped.success) return;
    expect(shipped.data.payments).toEqual(deducted.data.nextOrder.payments);
    expect(orderStateMachine.setDelivery(shipped.data, { resolved: { delivery: home, cost: money(1) } }))
      .toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
    const delivered = orderStateMachine.registerDelivery(shipped.data, paymentAt);
    expect(delivered).toMatchObject({ success: true, data: { deliveryStatus: "delivered", deliveredAt: paymentAt, completedAt: paymentAt } });
    if (!delivered.success) return;
    expect(delivered.data.payments).toEqual(shipped.data.payments);
    expect(orderStateMachine.getLifecycle(delivered.data)).toEqual({ success: true, data: { status: "completed", completedAt: paymentAt } });
    expect(orderStateMachine.getLifecycle({ ...delivered.data, deliveredAt: null }))
      .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(orderStateMachine.registerShipment(delivered.data)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
  });

  test("completes an immediate handover directly from pending delivery without logistics data", () => {
    const paid = orderStateMachine.registerPayment(order(), payment(5, 10));
    if (!paid.success) throw new Error("Expected payment");
    const deducted = orderStateMachine.planStockDeduction(paid.data, false);
    if (!deducted.success) throw new Error("Expected deduction plan");
    expect(orderStateMachine.registerDelivery(deducted.data.nextOrder, paymentAt)).toMatchObject({ success: true, data: {
      delivery: null, deliveryStatus: "delivered", completedAt: paymentAt, payments: paid.data.payments } });
  });

  test("cancels before dispatch, requests one restoration and preserves payments", () => {
    const paid = orderStateMachine.registerPayment(order(), payment(5, 10));
    if (!paid.success) throw new Error("Expected payment");
    const deducted = orderStateMachine.planStockDeduction(paid.data, false);
    if (!deducted.success) throw new Error("Expected deduction plan");
    const cancelled = orderStateMachine.cancel(deducted.data.nextOrder);
    expect(cancelled).toMatchObject({ success: true, data: { restoreStock: true, nextOrder: { cancelled: true, stockDeducted: false } } });
    if (!cancelled.success) return;
    expect(cancelled.data.nextOrder.payments).toEqual(paid.data.payments);
    expect(orderStateMachine.getLifecycle(cancelled.data.nextOrder)).toEqual({ success: true, data: { status: "cancelled", completedAt: null } });
    expect(orderStateMachine.cancel(cancelled.data.nextOrder)).toMatchObject({ success: true, data: { restoreStock: false } });
    expect(orderStateMachine.registerPayment(cancelled.data.nextOrder, payment(6, 1))).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
    expect(orderStateMachine.planStockDeduction(cancelled.data.nextOrder, true)).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
    const shipped = orderStateMachine.registerShipment(deducted.data.nextOrder);
    if (!shipped.success) throw new Error("Expected shipment");
    expect(orderStateMachine.cancel(shipped.data)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
  });
});
