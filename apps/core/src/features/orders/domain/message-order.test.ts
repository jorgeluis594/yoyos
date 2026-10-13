import { describe, expect, test } from "vitest";
import { isOpenForMessageItems, selectProductCode, type ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ConfirmedPayment, ReportedPayment } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const chatId = id(50) as ChatId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-01T12:00:00Z");
const open = (): OrderAggregate => ({
  number: 1001 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, chatId,
  buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false,
  items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Item", variantAttributes: {}, sku: null,
    quantity: 1 as PositiveInteger, unitPrice: money(10), subtotal: money(10) }],
  payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false,
  itemsTotal: money(10), deliveryCost: money(0), deliveryCharge: money(0), total: money(10),
});
const confirmed: ConfirmedPayment = { id: id(60) as PaymentId, orderId: id(1) as OrderId, status: "confirmed", amount: money(4), method: "digital_wallet",
  data: { confirmedAt: at, confirmedBy: { kind: "seller", userId: "seller" as UserId }, evidence: { kind: "manual" } } };
const reported: ReportedPayment = { id: id(61) as PaymentId, orderId: id(1) as OrderId, status: "reported", currency: "PEN", amount: null, method: null,
  data: { receiptImageId: id(70) as never, reportedAt: at } };
const code = (n: number) => id(n);

describe("selectProductCode", () => {
  test("selectProductCode skips with no_qr_code when nothing was decoded", () => {
    expect(selectProductCode([])).toEqual({ kind: "skip", reason: "no_qr_code" });
  });

  test("selectProductCode skips with unrecognized_qr_code when no decoded value is a UUID", () => {
    expect(selectProductCode(["https://pay.example/yape", "12345"])).toEqual({ kind: "skip", reason: "unrecognized_qr_code" });
  });

  test("selectProductCode keeps only UUID codes without duplicates in reading order", () => {
    expect(selectProductCode([code(2), "https://x.test", code(1), code(2)])).toEqual({ kind: "codes", codes: [code(2), code(1)] });
  });
});

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
