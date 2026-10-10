import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/buyer-payment";
import { orders } from "@core/src/features/orders/composition";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { err, ok } from "@shared/functional";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { CheckoutView, OrderNumber } from "@core/src/features/orders/domain/checkout";

vi.mock("@core/src/shared/infrastructure/logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/logger")>(), bindRequestOperation: vi.fn(),
}));

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const orderId = "00000000-0000-4000-8000-000000000002" as OrderId;
const total = { amount: 10, currency: "PEN" as const };
const checkout: CheckoutView = { companyName: "Store", number: 1001 as OrderNumber, buyer: null, itemsTotal: total, total, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" },
  items: [{ productName: "Product", sku: null, variantAttributes: {}, quantity: 1 as PositiveInteger, unitPrice: total, subtotal: total }], state: { kind: "pending" } };
const paymentView = { orderId, total, deliveryCharge: { amount: 0, currency: "PEN" as const }, availability: "available" as const,
  paidAmount: { amount: 0, currency: "PEN" as const }, balanceDue: total, paymentStatus: "pending" as const, settings: [], payments: [] };
const noCheckout = err({ code: "CHECKOUT_UNAVAILABLE" as const, message: "Not public" });
const open = (id: string) => loader({ params: { orderId: id } } as unknown as LoaderFunctionArgs);
const thrown = async (id: string) => open(id).then(() => { throw new Error("Expected a thrown response"); }, (response: Response) => response);
const lastOperation = () => vi.mocked(bindRequestOperation).mock.calls.at(-1)?.[0];

beforeEach(() => vi.mocked(bindRequestOperation).mockClear());
afterEach(() => vi.restoreAllMocks());

describe("legacy payment link", () => {
  test("redirects permanently to the checkout when the order has checkout enabled", async () => {
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
    const lookup = vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(checkout));
    const payment = vi.spyOn(orders, "getBuyerPaymentView");
    const response = await thrown(orderId);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(`/checkout/${companyId}/${orderId}`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(lookup).toHaveBeenCalledWith({ companyId, orderId });
    expect(payment).not.toHaveBeenCalled();
    expect(lastOperation()).toEqual({ operation: "redirect_buyer_payment", outcome: "redirected" });
  });

  test("renders the payment page for an order without checkout", async () => {
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
    vi.spyOn(orders, "getCheckout").mockResolvedValue(noCheckout);
    vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(ok(paymentView));
    expect(await open(orderId)).toEqual(paymentView);
    expect(lastOperation()).toEqual({ operation: "redirect_buyer_payment", outcome: "rendered" });
  });

  test("responds 404 for an unknown order", async () => {
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(err({ code: "ORDER_NOT_FOUND", message: "Order not found" }));
    expect((await thrown(orderId)).status).toBe(404);
    expect(lastOperation()).toEqual({ operation: "redirect_buyer_payment", outcome: "unavailable" });
  });

  test("responds 404 for an invalid order id", async () => {
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(err({ code: "INVALID_ORDER", message: "Invalid order ID" }));
    expect((await thrown("not-a-uuid")).status).toBe(404);
  });

  test("responds 503 when the order cannot be resolved", async () => {
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database down" }));
    expect((await thrown(orderId)).status).toBe(503);
    expect(lastOperation()).toEqual({ operation: "redirect_buyer_payment", outcome: "technical_failure" });
  });

  test("responds 503 and logs when the checkout lookup fails", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
    vi.spyOn(orders, "getCheckout").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database down" }));
    expect((await thrown(orderId)).status).toBe(503);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "PERSISTENCE_UNAVAILABLE" }), expect.any(String));
  });

  test("responds 409 for a cancelled order without checkout", async () => {
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
    vi.spyOn(orders, "getCheckout").mockResolvedValue(noCheckout);
    vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(err({ code: "ORDER_CANCELLED", message: "Cancelled" }));
    expect((await thrown(orderId)).status).toBe(409);
    expect(lastOperation()).toEqual({ operation: "redirect_buyer_payment", outcome: "cancelled" });
  });

  test("responds 503 and logs an invalid payment view", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
    vi.spyOn(orders, "getCheckout").mockResolvedValue(noCheckout);
    vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(ok({ ...paymentView, orderId: "bad" }));
    expect((await thrown(orderId)).status).toBe(503);
    expect(error).toHaveBeenCalled();
  });
});
