import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider, type ActionFunctionArgs } from "react-router";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import resources from "@core/app/locales";
import { afterEach, expect, test, vi } from "vitest";
import OrderDetail, { action, buyerLink, clientAction, shouldRevalidate } from "@core/app/routes/order-detail";
import { buildPendingCatalogOrder, buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
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


test("cancellation validates ID and uses only authenticated scope without payment operations", async () => {
  const cancel = vi.spyOn(orders, "cancel").mockResolvedValue(err({ code: "ORDER_NOT_FOUND", message: "Unavailable" }));
  const confirm = vi.spyOn(orders, "registerPayment");
  const voidPayment = vi.spyOn(orders, "voidPayment");
  expect(await action({ ...args({ operation: "cancel" }), params: { orderId: "invalid" } })).toMatchObject({ operation: "cancel", result: { success: false, error: { code: "INVALID_INPUT" } } });
  expect(cancel).not.toHaveBeenCalled();
  expect(await action(args({ operation: "cancel", companyId: "foreign", sellerId: "foreign" }))).toEqual({ operation: "cancel", result: err({ code: "ORDER_NOT_FOUND", message: "Unavailable" }) });
  expect(cancel).toHaveBeenCalledWith(orderId, { companyId, userId: "authenticated-seller" });
  expect(confirm).not.toHaveBeenCalled(); expect(voidPayment).not.toHaveBeenCalled();
});

test("lost cancellation response reads once, preserves uncertainty and manual check never writes", async () => {
  const fetch = vi.fn(async () => { throw new Error("Offline"); });
  vi.stubGlobal("fetch", fetch);
  const serverAction = vi.fn(async () => { throw new Error("Lost response"); });
  try {
    const request = new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", body: new URLSearchParams({ operation: "cancel" }) });
    const result = await clientAction({ ...args(), request, params: { orderId }, serverAction });
    expect(result).toMatchObject({ operation: "cancellation", outcome: { kind: "uncertain" } });
    expect(serverAction).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    expect(shouldRevalidate({ actionResult: result, defaultShouldRevalidate: true })).toBe(false);
    const check = new Request(request.url, { method: "POST", body: new URLSearchParams({ operation: "check-cancellation" }) });
    expect(await clientAction({ ...args(), request: check, params: { orderId }, serverAction })).toMatchObject({ outcome: { kind: "uncertain" } });
    expect(serverAction).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});

test("buyer link opens the checkout only when it is enabled and the order is active", () => {
  const order = { id: orderId, companyId, cancelled: false, checkoutEnabledAt: null };
  expect(buyerLink(order)).toBeNull();
  expect(buyerLink({ ...order, cancelled: true })).toBeNull();
  const enabled = { ...order, checkoutEnabledAt: "2026-10-05T00:00:00.000Z" };
  expect(buyerLink(enabled)).toEqual({ href: `/checkout/${companyId}/${orderId}`, label: "orders.buyerPaymentLink" });
  expect(buyerLink({ ...enabled, cancelled: true })).toBeNull();
});

test("order detail shows «Desde el catálogo» and no seller for a catalog order, and the seller for a manual one", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const seller = id(9);
  const items = [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Polo", variantAttributes: {}, sku: null,
    quantity: 1, unitPrice: { amount: 45, currency: "PEN" as const } }];
  const common = { id: id(2) as OrderId, companyId: companyId as CompanyId, number: 1042 as OrderNumber, customer: { kind: "general_public" } as const,
    createdAt: new Date("2026-10-17T12:00:00Z"), items };
  const catalog = buildPendingCatalogOrder(common);
  const manual = buildPendingOrder({ ...common, sellerId: seller as UserId });
  if (!catalog.success || !manual.success) throw new Error("expected orders");
  const render = (order: OrderAggregate) => {
    const router = createMemoryRouter([{ id: "detail", path: "/", element: createElement(OrderDetail), loader: () => null }], {
      hydrationData: { loaderData: { detail: { order: toOrderAggregateJson(order), base: "/es-PE/orders", manualPaymentId: id(5), receiptUrls: {},
        settings: null, settingsPath: "/es-PE/settings/delivery" } } } });
    try { return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))); }
    finally { router.dispose(); }
  };
  const fromCatalog = render({ ...catalog.data, checkoutConfirmedAt: new Date("2026-10-17T12:05:00Z") });
  expect(fromCatalog).toContain("Desde el catálogo");
  expect(fromCatalog).not.toContain(seller);
  const fromSeller = render(manual.data);
  expect(fromSeller).not.toContain("Desde el catálogo");
  expect(fromSeller).toContain(seller);
});
