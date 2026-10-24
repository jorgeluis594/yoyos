import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import resources from "@core/app/locales";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import OrderDetail, { action, clientAction, loader, shouldRevalidate } from "@core/app/routes/order-detail";
import { buildPendingCatalogOrder, buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { orders } from "@core/src/features/orders/composition";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { ok, err } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";

const companyId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const args = (fields: Record<string, string> = {}) => ({ params: { orderId },
  context: { get: () => ({ company: { id: companyId }, user: { id: "authenticated-seller" } }) },
  request: new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", body: new URLSearchParams(fields) }),
}) as unknown as ActionFunctionArgs;
afterEach(() => vi.restoreAllMocks());

test("a bare seller post no longer enables or reads the checkout link", async () => {
  const enable = vi.spyOn(orders, "enableCheckout");
  expect(await action(args())).toMatchObject({ data: { url: null, error: true }, init: { status: 422 } });
  expect(await action(args({ companyId: "foreign" }))).toMatchObject({ init: { status: 422 } });
  expect(enable).not.toHaveBeenCalled();
});

beforeEach(() => { vi.spyOn(deliverySettings, "get").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "unused" })); });
const loaderArgs = (company: Record<string, unknown> = { id: companyId, country: "PE" }) => ({ params: { orderId },
  context: { get: () => ({ company, user: { id: "authenticated-seller" } }) },
  request: new Request(`http://localhost/es-PE/orders/${orderId}`),
}) as unknown as LoaderFunctionArgs;
const aggregate = (patch: Partial<OrderAggregate> = {}) => {
  const items = [{ id: orderId as OrderItemId, variantId: orderId as VariantId, productName: "Polo", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 45, currency: "PEN" as const } }];
  const built = buildPendingOrder({ id: orderId as OrderId, companyId: companyId as CompanyId, number: 1042 as OrderNumber, customer: { kind: "general_public" },
    createdAt: new Date("2026-10-17T12:00:00Z"), items, sellerId: "authenticated-seller" as UserId });
  if (!built.success) throw new Error("expected order");
  return { ...built.data, ...patch };
};

test("the loader builds the absolute brand-host link from the company's subdomain without enabling anything", async () => {
  const url = `https://fantasio.yoyos.lat/checkout/${companyId}/${orderId}`;
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(aggregate()));
  const checkoutUrl = vi.spyOn(orders, "checkoutUrl").mockResolvedValue(ok(url));
  const enable = vi.spyOn(orders, "enableCheckout");
  expect(await loader(loaderArgs())).toMatchObject({ link: { kind: "ready", url } });
  expect(checkoutUrl).toHaveBeenCalledWith(companyId, orderId);
  expect(enable).not.toHaveBeenCalled();
});

test("without a subdomain the loader points to Apariencia de la tienda's publication card", async () => {
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(aggregate()));
  vi.spyOn(orders, "checkoutUrl").mockResolvedValue(err({ code: "SUBDOMAIN_REQUIRED", message: "The company has no catalog subdomain" }));
  expect(await loader(loaderArgs())).toMatchObject({ link: { kind: "subdomain_required", appearancePath: "/es-PE/settings/store-appearance#catalog-publication" } });
});

test("a cancelled order gets no link and no lookup", async () => {
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(aggregate({ cancelled: true })));
  const checkoutUrl = vi.spyOn(orders, "checkoutUrl");
  expect(await loader(loaderArgs())).toMatchObject({ link: { kind: "unavailable" } });
  expect(checkoutUrl).not.toHaveBeenCalled();
});

test("a failed subdomain read leaves the page with an unavailable link instead of failing it", async () => {
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(aggregate()));
  vi.spyOn(orders, "checkoutUrl").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  vi.spyOn(log, "error").mockImplementation(() => undefined);
  expect(await loader(loaderArgs())).toMatchObject({ link: { kind: "unavailable" }, order: { id: orderId } });
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
        settings: null, settingsPath: "/es-PE/settings/delivery", link: { kind: "ready", url: "https://fantasio.yoyos.lat/checkout/x/y" } } } } });
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
