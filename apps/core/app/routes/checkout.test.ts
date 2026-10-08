import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, headers, loader } from "@core/app/routes/checkout";
import { orders } from "@core/src/features/orders/composition";
import { log } from "@core/src/shared/infrastructure/logger";
import { ok, err } from "@shared/functional";
import type { CheckoutView, OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";

const params = { companyId: "00000000-0000-4000-8000-000000000001", orderId: "00000000-0000-4000-8000-000000000002" };
const total = { amount: 10, currency: "PEN" as const };
const view: CheckoutView = { companyName: "Store", number: 1001 as OrderNumber, buyer: null, itemsTotal: total, total, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" },
  items: [{ productName: "Product", sku: null, variantAttributes: {}, quantity: 1 as PositiveInteger, unitPrice: total, subtotal: total }], state: { kind: "pending" } };
const body = { buyer: { name: "Ana", phone: "+51987654321" }, expectedTotal: total };
const args = (payload: unknown, path = params) => ({ params: path, request: new Request("http://localhost/checkout/company/order", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
}) } as unknown as ActionFunctionArgs);
afterEach(() => vi.restoreAllMocks());

test("public loader preserves wire amounts and privacy headers without requiring an authenticated context", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(view));
  expect(await loader({ params } as unknown as LoaderFunctionArgs)).toMatchObject({ data: { checkout: view }, init: { headers: headers() } });
  await expect(loader({ params: { companyId: "bad", orderId: "1001" } } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
  vi.mocked(orders.getCheckout).mockResolvedValue(err({ code: "CHECKOUT_UNAVAILABLE", message: "not public" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
});

test("public action rejects tampering and attaches field errors before calling the use case", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckout");
  expect(await action(args({ ...body, companyId: params.companyId }))).toMatchObject({ init: { status: 422 } });
  expect(await action(args({ ...body, buyer: { name: " ", phone: "invalid" } }))).toMatchObject({
    data: { fieldErrors: { name: expect.any(String), phone: expect.any(String) } }, init: { status: 422 },
  });
  expect(await action(args(body, { ...params, orderId: "bad" }))).toMatchObject({ data: { unavailable: true }, init: { status: 404 } });
  expect(confirm).not.toHaveBeenCalled();
});

test("total conflict returns the current checkout and requires another explicit confirmation", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckout").mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "changed" }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok({ ...view, total: { ...total, amount: 12 } }));
  expect(await action(args(body))).toMatchObject({ data: { checkout: { total: { amount: 12 } }, message: expect.stringContaining("vuelve a confirmar") }, init: { status: 409 } });
  expect(confirm).toHaveBeenCalledTimes(1);
});

test("form submission serializes confirmation dates and does not expose private buyer fields", async () => {
  const confirmed = { ...view, buyer: body.buyer, state: { kind: "confirmed" as const, confirmedAt: new Date("2026-10-05T00:00:00Z") } };
  vi.spyOn(orders, "confirmCheckout").mockResolvedValue(ok(confirmed));
  const request = new Request("http://localhost/checkout/company/order", { method: "POST", body: new URLSearchParams({ ...body.buyer, expectedTotal: JSON.stringify(total) }) });
  expect(await action({ params, request } as unknown as ActionFunctionArgs)).toMatchObject({ data: { checkout: { buyer: body.buyer, state: { kind: "confirmed", confirmedAt: "2026-10-05T00:00:00.000Z" } } }, init: { status: 200 } });
});

test("cancelled, unavailable and technical failures never return false confirmation", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckout").mockResolvedValue(err({ code: "ORDER_CANCELLED", message: "cancelled" }));
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
  expect((result as Response).headers.get("Location")).toBe(`/pago/${params.orderId}`);
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
