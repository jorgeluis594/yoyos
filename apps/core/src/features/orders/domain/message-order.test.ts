import { describe, expect, test } from "vitest";
import { isOpenForMessageItems, messageOpenIntervals, type ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ConfirmedPayment, RejectedPayment, ReportedPayment, VoidedPayment } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const chatId = id(50) as ChatId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-01T12:00:00Z");
const open = (): OrderAggregate => ({
  number: 1001 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, chatId,
  buyer: null, fromCatalog: false, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
  items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Item", variantAttributes: {}, sku: null,
    quantity: 1 as PositiveInteger, unitPrice: money(10), subtotal: money(10) }],
  payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(10), deliveryCost: money(0), deliveryCharge: money(0), total: money(10),
});
const confirmed: ConfirmedPayment = { id: id(60) as PaymentId, orderId: id(1) as OrderId, status: "confirmed", amount: money(4), method: "digital_wallet", deductStockIfPartial: false,
  data: { confirmedAt: at, confirmedBy: { kind: "seller", userId: "seller" as UserId }, evidence: { kind: "manual" } } };
const reported: ReportedPayment = { id: id(61) as PaymentId, orderId: id(1) as OrderId, status: "reported", currency: "PEN", amount: null, method: null,
  data: { receiptImageId: id(70) as never, reportedAt: at } };
describe("isOpenForMessageItems", () => {
  test("an active pending order of the message chat without payments is open", () => {
    expect(isOpenForMessageItems(open(), chatId)).toBe(true);
  });

  test("a manual order or an order of another chat is not open", () => {
    const manual: OrderAggregate = { ...open(), chatId: undefined };
    expect(isOpenForMessageItems(manual, chatId)).toBe(false);
    expect(isOpenForMessageItems({ ...open(), chatId: null }, chatId)).toBe(false);
    expect(isOpenForMessageItems({ ...open(), chatId: id(51) as ChatId }, chatId)).toBe(false);
  });

  test("cancelled and completed orders are not open", () => {
    expect(isOpenForMessageItems({ ...open(), cancelled: true }, chatId)).toBe(false);
    expect(isOpenForMessageItems({ ...open(), completedAt: at }, chatId)).toBe(false);
  });

  test("an order with a confirmed or reported payment is not open", () => {
    expect(isOpenForMessageItems({ ...open(), payments: [confirmed] }, chatId)).toBe(false);
    expect(isOpenForMessageItems({ ...open(), payments: [reported] }, chatId)).toBe(false);
  });

  test("an order with a confirmed checkout is not open", () => {
    expect(isOpenForMessageItems({ ...open(), checkoutEnabledAt: at, checkoutConfirmedAt: at }, chatId)).toBe(false);
  });

  test("a dispatched order or one with deducted stock is not open", () => {
    expect(isOpenForMessageItems({ ...open(), stockDeducted: true }, chatId)).toBe(false);
    expect(isOpenForMessageItems({ ...open(), stockDeducted: true, deliveryStatus: "shipped" }, chatId)).toBe(false);
  });

  test("an order with checkout enabled but not confirmed is still open", () => {
    expect(isOpenForMessageItems({ ...open(), checkoutEnabledAt: at }, chatId)).toBe(true);
  });
});

const hours = (n: number) => new Date(at.getTime() + n * 3600_000);
const confirmedAt = (n: number, paymentId = 60): ConfirmedPayment => ({ ...confirmed, id: id(paymentId) as PaymentId, data: { ...confirmed.data, confirmedAt: hours(n) } });
const reportedAt = (n: number, paymentId = 61): ReportedPayment => ({ ...reported, id: id(paymentId) as PaymentId, data: { ...reported.data, reportedAt: hours(n) } });
const voidedAt = (payment: ConfirmedPayment, n: number): VoidedPayment => ({ ...payment, status: "voided", data: { ...payment.data, voidedAt: hours(n), voidedBy: "seller" as UserId } });
const orderWith = (changes: Partial<OrderAggregate>): OrderAggregate => ({ ...open(), ...changes });
const spans = (order: OrderAggregate) => messageOpenIntervals(order, chatId).map((interval) => [interval.from.getTime() - at.getTime(), interval.until && interval.until.getTime() - at.getTime()]);
const h = (n: number) => n * 3600_000;

describe("messageOpenIntervals", () => {
  test("opens an order at creation and closes it at its first payment report", () => {
    expect(spans(orderWith({}))).toEqual([[0, null]]);
    expect(spans(orderWith({ payments: [reportedAt(5)] }))).toEqual([[0, h(5)]]);
  });

  test("reopens an order at the void of its last active payment only", () => {
    expect(spans(orderWith({ payments: [voidedAt(confirmedAt(2), 6)] }))).toEqual([[0, h(2)], [h(6), null]]);
  });

  test("never reopens an order at a void while another payment is still confirmed", () => {
    expect(spans(orderWith({ payments: [voidedAt(confirmedAt(2, 60), 6), confirmedAt(3, 62)] }))).toEqual([[0, h(2)]]);
  });

  test("reopens an order only at the void of the second of two payments", () => {
    expect(spans(orderWith({ payments: [voidedAt(confirmedAt(2, 60), 6), voidedAt(confirmedAt(3, 62), 8)] }))).toEqual([[0, h(2)], [h(8), null]]);
  });

  test("never reopens an order after a rejected payment", () => {
    const rejected: RejectedPayment = { id: id(63) as PaymentId, orderId: id(1) as OrderId, status: "rejected", currency: "PEN", amount: null, method: null,
      data: { report: { receiptImageId: id(70) as never, reportedAt: hours(2) }, rejectedAt: hours(3), rejectedBy: "seller" as UserId, reason: null } };
    expect(spans(orderWith({ payments: [rejected, voidedAt(confirmedAt(4), 6)] }))).toEqual([[0, h(2)]]);
  });

  test("dates a confirmed payment that came from a buyer report at its report", () => {
    const fromReport: ConfirmedPayment = { ...confirmedAt(5), data: { ...confirmedAt(5).data, evidence: { kind: "buyer_report", report: { receiptImageId: id(70) as never, reportedAt: hours(2) } } } };
    expect(spans(orderWith({ payments: [fromReport] }))).toEqual([[0, h(2)]]);
  });

  test("never reopens an order at a void after checkout confirmation, shipment, stock deduction or cancellation", () => {
    const voided = voidedAt(confirmedAt(2), 6);
    for (const closing of [{ checkoutConfirmedAt: hours(1) }, { shippedAt: hours(1), deliveryStatus: "shipped" as const }, { stockDeductedAt: hours(1) }, { cancelled: true, cancelledAt: hours(1) }]) {
      expect(spans(orderWith({ ...closing, payments: [voided] }))).toEqual([[0, h(1)]]);
    }
  });

  test("a void after stock deduction never reopens the order", () => {
    expect(spans(orderWith({ stockDeducted: true, stockDeductedAt: hours(3), payments: [voidedAt(confirmedAt(2), 6)] }))).toEqual([[0, h(2)]]);
  });

  test("keeps a cancelled order with restored stock closed from its cancellation and from its first deduction", () => {
    const restored = orderWith({ cancelled: true, cancelledAt: hours(4), stockDeducted: false, stockDeductedAt: hours(1) });
    expect(spans(restored)).toEqual([[0, h(1)]]);
    expect(spans({ ...restored, stockDeductedAt: null })).toEqual([[0, h(4)]]);
  });

  test("ignores completedAt cleared by a void and deliveryStatus reset by a cancellation", () => {
    expect(spans(orderWith({ payments: [voidedAt(confirmedAt(2), 6)], completedAt: null }))).toEqual([[0, h(2)], [h(6), null]]);
    expect(spans(orderWith({ cancelled: true, cancelledAt: hours(4), deliveryStatus: "pending", shippedAt: hours(3) }))).toEqual([[0, h(3)]]);
  });

  test("has no interval for an order of another chat or a manual order", () => {
    expect(messageOpenIntervals({ ...open(), chatId: null }, chatId)).toEqual([]);
    expect(messageOpenIntervals({ ...open(), chatId: id(51) as ChatId }, chatId)).toEqual([]);
  });

  test("agrees with isOpenForMessageItems about the order as it is now", () => {
    const orders: OrderAggregate[] = [open(), orderWith({ payments: [confirmedAt(2)] }), orderWith({ payments: [reportedAt(2)] }),
      orderWith({ payments: [voidedAt(confirmedAt(2), 6)] }), orderWith({ payments: [voidedAt(confirmedAt(2, 60), 6), confirmedAt(3, 62)] }),
      orderWith({ cancelled: true, cancelledAt: hours(1) }), orderWith({ stockDeducted: true, stockDeductedAt: hours(1) }),
      orderWith({ checkoutEnabledAt: hours(1), checkoutConfirmedAt: hours(2) }), orderWith({ shippedAt: hours(1), deliveryStatus: "shipped" }),
      orderWith({ completedAt: hours(9), deliveredAt: hours(8), deliveryStatus: "delivered" })];
    for (const order of orders) {
      const last = messageOpenIntervals(order, chatId).at(-1);
      expect(last?.until === null, JSON.stringify(order.payments.map((payment) => payment.status))).toBe(isOpenForMessageItems(order, chatId));
    }
  });
});
