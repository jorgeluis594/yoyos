import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, headers, loader } from "@core/app/routes/checkout";
import { orders } from "@core/src/features/orders/composition";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { log } from "@core/src/shared/infrastructure/logger";
import { ok, err } from "@shared/functional";
import type { CheckoutView, OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";

const params = { companyId: "00000000-0000-4000-8000-000000000001", orderId: "00000000-0000-4000-8000-000000000002" };
const total = { amount: 10, currency: "PEN" as const };
const view: CheckoutView = { companyName: "Store", number: 1001 as OrderNumber, buyer: null, itemsTotal: total, total, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" },
  items: [{ productName: "Product", sku: null, variantAttributes: {}, quantity: 1 as PositiveInteger, unitPrice: total, subtotal: total }], state: { kind: "pending" } };
const body = { buyer: { name: "Ana", phone: "+51987654321" }, expectedTotal: total, delivery: { kind: "keep" as const } };
const args = (payload: unknown, path = params) => ({ params: path, request: new Request("http://localhost/checkout/company/order", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
}) } as unknown as ActionFunctionArgs);
afterEach(() => vi.restoreAllMocks());

test("public loader preserves wire amounts and privacy headers without requiring an authenticated context", async () => {
  const settings = vi.spyOn(deliverySettings, "getForCompany").mockResolvedValue(ok({ version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(view));
  expect(await loader({ params } as unknown as LoaderFunctionArgs)).toMatchObject({ data: { checkout: view }, init: { headers: headers() } });
  await expect(loader({ params: { companyId: "bad", orderId: "1001" } } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
  vi.mocked(orders.getCheckout).mockResolvedValue(err({ code: "CHECKOUT_UNAVAILABLE", message: "not public" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
  expect(settings).toHaveBeenCalledTimes(1);
});

test("public action rejects tampering and attaches field errors before calling the use case", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
  expect(await action(args({ ...body, companyId: params.companyId }))).toMatchObject({ init: { status: 422 } });
  expect(await action(args({ ...body, buyer: { name: " ", phone: "invalid" } }))).toMatchObject({
    data: { fieldErrors: { name: expect.any(String), phone: expect.any(String) } }, init: { status: 422 },
  });
  expect(await action(args(body, { ...params, orderId: "bad" }))).toMatchObject({ data: { unavailable: true }, init: { status: 404 } });
  expect(confirm).not.toHaveBeenCalled();
});

test("total conflict returns the current checkout and requires another explicit confirmation", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "changed" }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok({ ...view, total: { ...total, amount: 12 } }));
  expect(await action(args(body))).toMatchObject({ data: { checkout: { total: { amount: 12 } }, message: expect.stringContaining("vuelve a confirmar") }, init: { status: 409 } });
  expect(confirm).toHaveBeenCalledTimes(1);
});

test("confirmation requires an explicit delivery choice for JSON and form requests", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
  const withoutDelivery = { buyer: body.buyer, expectedTotal: body.expectedTotal };
  expect(await action(args(withoutDelivery))).toMatchObject({ init: { status: 422 } });
  const fields = new URLSearchParams({ ...body.buyer, expectedTotal: JSON.stringify(total) });
  const request = new Request("http://localhost/checkout/company/order", { method: "POST", body: fields });
  expect(await action({ params, request } as unknown as ActionFunctionArgs)).toMatchObject({ init: { status: 422 } });
  expect(confirm).not.toHaveBeenCalled();
});

test("cancelled, unavailable and technical failures never return false confirmation", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(err({ code: "ORDER_CANCELLED", message: "cancelled" }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok({ ...view, state: { kind: "cancelled" } }));
  expect(await action(args(body))).toMatchObject({ data: { checkout: { state: { kind: "cancelled" } } }, init: { status: 409 } });
  confirm.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "private cause" }));
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  expect(await action(args(body))).toMatchObject({ data: { checkout: null }, init: { status: 503 } });
  expect(error).not.toHaveBeenCalled();
  confirm.mockRejectedValue(new Error("private cause"));
  expect(await action(args(body))).toMatchObject({ data: { checkout: null }, init: { status: 503 } });
  expect(error).toHaveBeenCalledTimes(1);
});

test("delivery confirmation constructs domain selection and redirects to payment only on success", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
  const delivery = { kind: "replace", selection: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } };
  const result = await action(args({ ...body, delivery }));
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).headers.get("Location")).toBe(`/checkout/${params.companyId}/${params.orderId}`);
  expect((result as Response).headers.get("Cache-Control")).toBe("no-store");
  expect(confirm).toHaveBeenCalledWith({ ...body, delivery }, params);
});

test("delivery price conflict preserves current checkout and returns the price for explicit reconfirmation", async () => {
  vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "Private reason", currentPrice: { amount: 12, currency: "PEN" } }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(view));
  expect(await action(args({ ...body, delivery: { kind: "keep" } }))).toMatchObject({ init: { status: 409 },
    data: { checkout: view, code: "TOTAL_CHANGED", currentPrice: { amount: 12, currency: "PEN" }, message: expect.stringContaining("vuelve a confirmar") } });
});

test("delivery business failures do not redirect or falsely confirm", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
  for (const error of [{ code: "RATE_UNAVAILABLE", message: "Private reason" }, { code: "INVALID_DISTRICT", message: "Private reason" },
    { code: "DELIVERY_METHOD_DISABLED", message: "Private reason" }] as const) {
    const code = error.code;
    confirm.mockResolvedValue(err(error));
    expect(await action(args({ ...body, delivery: { kind: "keep" } }))).toMatchObject({ init: { status: 422 }, data: { checkout: null, code } });
  }
  confirm.mockResolvedValue(err({ code: "INSUFFICIENT_STOCK", message: "Private reason" }));
  expect(await action(args({ ...body, delivery: { kind: "keep" } }))).toMatchObject({ init: { status: 409 }, data: { checkout: null } });
});

test("delivery form accepts exactly four fields and rejects repeated delivery values", async () => {
  vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
  const fields = new URLSearchParams({ ...body.buyer, expectedTotal: JSON.stringify(total), delivery: JSON.stringify({ kind: "keep" }) });
  const request = () => new Request("http://localhost/checkout/company/order", { method: "POST", body: fields });
  expect(await action({ params, request: request() } as unknown as ActionFunctionArgs)).toBeInstanceOf(Response);
  fields.append("delivery", JSON.stringify({ kind: "keep" }));
  expect(await action({ params, request: request() } as unknown as ActionFunctionArgs)).toMatchObject({ init: { status: 422 } });
});

test("public checkout exposes current pickup configuration without courier names or seller identity", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(view));
  vi.spyOn(deliverySettings, "getForCompany").mockResolvedValue(ok({ version: 7, home: { enabled: true }, agency: { enabled: false }, couriers: [],
    store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } }));
  const result = await loader({ params } as unknown as LoaderFunctionArgs);
  expect(result.data.deliveryOptions).toEqual({ home: { enabled: true }, agency: { enabled: false },
    store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } });
  expect(result.data.deliveryOptions).not.toHaveProperty("version");
  expect(result.data.deliveryOptions).not.toHaveProperty("couriers");
});

test("failed current configuration does not manufacture free shipping or enabled pickup", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(view));
  vi.spyOn(deliverySettings, "getForCompany").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Private detail" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
});

const paymentView = { orderId: params.orderId, total, deliveryCharge: { amount: 0, currency: "PEN" as const }, availability: "available" as const,
  paidAmount: { amount: 0, currency: "PEN" as const }, balanceDue: total, paymentStatus: "pending" as const, settings: [], payments: [] };
const confirmed = ok({ ...view, buyer: body.buyer, state: { kind: "confirmed" as const, confirmedAt: new Date("2026-10-05T00:00:00Z") } });

test("confirmed checkout keeps its saved summary and loads the payment view without requiring current delivery settings", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(confirmed);
  const payment = vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(ok(paymentView));
  const settings = vi.spyOn(deliverySettings, "getForCompany");
  expect(await loader({ params } as unknown as LoaderFunctionArgs)).toMatchObject({
    data: { checkout: { total, state: { kind: "confirmed" } }, payment: paymentView }, init: { headers: headers() } });
  expect(payment).toHaveBeenCalledWith(params.orderId);
  expect(settings).not.toHaveBeenCalled();
});

test("confirmed checkout answers 503 when the payment view cannot be loaded", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(confirmed);
  vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database down" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
});
