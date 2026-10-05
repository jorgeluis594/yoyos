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
const view: CheckoutView = { companyName: "Store", number: 1001 as OrderNumber, buyer: null, itemsTotal: total, total,
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
