import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import { action } from "@core/app/routes/order-detail";
import { orders } from "@core/src/features/orders/composition";
import { ok, err } from "@shared/functional";

const companyId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const args = (fields: Record<string, string> = {}) => ({ params: { orderId },
  context: { get: () => ({ company: { id: companyId }, user: { id: "authenticated-seller" } }) },
  request: new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", body: new URLSearchParams(fields) }),
}) as unknown as ActionFunctionArgs;
afterEach(() => vi.restoreAllMocks());

test("seller link action derives company and user from authenticated context and rejects injected fields", async () => {
  const enable = vi.spyOn(orders, "enableCheckout").mockResolvedValue(ok({ url: `http://localhost/checkout/${companyId}/${orderId}` }));
  expect(await action(args({ companyId: "foreign" }))).toMatchObject({ init: { status: 422 } });
  expect(enable).not.toHaveBeenCalled();
  expect(await action(args())).toMatchObject({ data: { url: expect.stringContaining(`/checkout/${companyId}/${orderId}`), error: false }, init: { headers: { "Cache-Control": "no-store" } } });
  expect(enable).toHaveBeenCalledWith(orderId, { companyId, userId: "authenticated-seller" });
});

test("seller action cannot expose a link for cancelled or unavailable orders", async () => {
  const enable = vi.spyOn(orders, "enableCheckout").mockResolvedValue(err({ code: "ORDER_CANCELLED", message: "Cancelled" }));
  expect(await action(args())).toMatchObject({ data: { url: null, error: true }, init: { status: 409 } });
  enable.mockResolvedValue(err({ code: "CHECKOUT_UNAVAILABLE", message: "Unavailable" }));
  expect(await action(args())).toMatchObject({ data: { url: null, error: true }, init: { status: 404 } });
});

test.each(["confirm", "void"])("seller %s action dispatches payment operations without enabling checkout", async (operation) => {
  const enable = vi.spyOn(orders, "enableCheckout");
  const confirm = vi.spyOn(orders, "registerPayment").mockResolvedValue(err({ code: "ORDER_NOT_FOUND", message: "Unavailable" }));
  const voidPayment = vi.spyOn(orders, "voidPayment").mockResolvedValue(err({ code: "ORDER_NOT_FOUND", message: "Unavailable" }));
  const paymentId = "00000000-0000-4000-8000-000000000003";
  expect(await action(args({ operation, paymentId, source: "manual", amount: "12.50", currency: "PEN", method: "bank_transfer" })))
    .toMatchObject({ url: null, success: false, error: "ORDER_NOT_FOUND" });
  expect(operation === "confirm" ? confirm : voidPayment).toHaveBeenCalledWith(
    expect.objectContaining({ orderId, paymentId }), { companyId, userId: "authenticated-seller" });
  expect(operation === "confirm" ? voidPayment : confirm).not.toHaveBeenCalled();
  expect(enable).not.toHaveBeenCalled();
});

test.each(["ship", "deliver"] as const)("seller %s action uses fulfillment and never changes payments", async operation => {
  const fulfillment = vi.spyOn(orders, operation).mockResolvedValue(err({ code: "PAYMENT_REQUIRED", message: "Unpaid" }));
  const confirm = vi.spyOn(orders, "registerPayment");
  const voidPayment = vi.spyOn(orders, "voidPayment");
  const enable = vi.spyOn(orders, "enableCheckout");
  expect(await action(args({ operation }))).toEqual({ operation, url: null, success: false, error: "PAYMENT_REQUIRED" });
  expect(fulfillment).toHaveBeenCalledWith(orderId, { companyId, userId: "authenticated-seller" });
  expect(confirm).not.toHaveBeenCalled();
  expect(voidPayment).not.toHaveBeenCalled();
  expect(enable).not.toHaveBeenCalled();
  fulfillment.mockResolvedValue(err({ code: "STOCK_NOT_DEDUCTED", message: "Stock pending" }));
  expect(await action(args({ operation }))).toMatchObject({ error: "STOCK_NOT_DEDUCTED" });
  fulfillment.mockRejectedValue(new Error("Unavailable"));
  expect(await action(args({ operation }))).toMatchObject({ operation, success: false, error: "INTERNAL_ERROR" });
});

test("seller cancellation uses authenticated scope, preserves payments and reports conflicts", async () => {
  const cancel = vi.spyOn(orders, "cancel").mockResolvedValue(err({ code: "INVALID_TRANSITION", message: "Already shipped" }));
  const confirm = vi.spyOn(orders, "registerPayment");
  const voidPayment = vi.spyOn(orders, "voidPayment");
  expect(await action(args({ operation: "cancel", companyId: "foreign" })))
    .toEqual({ operation: "cancel", url: null, success: false, error: "INVALID_TRANSITION" });
  expect(cancel).toHaveBeenCalledWith(orderId, { companyId, userId: "authenticated-seller" });
  expect(confirm).not.toHaveBeenCalled();
  expect(voidPayment).not.toHaveBeenCalled();
  cancel.mockClear();
  expect(await action({ ...args({ operation: "cancel" }), params: { orderId: "invalid" } })).toMatchObject({ init: { status: 422 } });
  expect(cancel).not.toHaveBeenCalled();
  cancel.mockRejectedValue(new Error("Unavailable"));
  expect(await action(args({ operation: "cancel" }))).toMatchObject({ operation: "cancel", success: false, error: "INTERNAL_ERROR" });
});
