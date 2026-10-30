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
import { resolvePublicImages } from "@core/src/shared/images";
import { ok, err } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { paymentErrorKey } from "@core/src/features/orders/presentation/payment-decision-form";

vi.mock("@core/src/shared/images", async (importOriginal) => ({ ...await importOriginal<typeof import("@core/src/shared/images")>(), resolvePublicImages: vi.fn() }));

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

beforeEach(() => {
  vi.spyOn(deliverySettings, "get").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "unused" }));
  vi.mocked(resolvePublicImages).mockReset().mockResolvedValue(ok({ images: [], failures: [] }));
});
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
  const url = `https://fantasio.yoyos.lat/checkout/${orderId}`;
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
  const failure = vi.spyOn(log, "error").mockImplementation(() => undefined);
  expect(await loader(loaderArgs())).toMatchObject({ link: { kind: "unavailable" }, order: { id: orderId } });
  const [payload] = failure.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(payload).toMatchObject({ event: "order_checkout_link_unavailable", companyId, orderNumber: 1042 });
  expect(payload).not.toHaveProperty("orderId");
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
      hydrationData: { loaderData: { detail: { order: toOrderAggregateJson(order, null), base: "/es-PE/orders", manualPaymentId: id(5), receiptUrls: {},
        settings: null, settingsPath: "/es-PE/settings/delivery", link: { kind: "ready", url: "https://fantasio.yoyos.lat/checkout/7bf00000-0000-4000-8000-000000000002" } } } } });
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

test("order detail offers «Imprimir rótulo» for any order, cancelled included, because the dialog explains why there is no label", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const built = buildPendingOrder({ id: id(2) as OrderId, companyId: companyId as CompanyId, number: 1042 as OrderNumber, customer: { kind: "general_public" },
    createdAt: new Date("2026-10-17T12:00:00Z"), sellerId: id(9) as UserId,
    items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Polo", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 45, currency: "PEN" as const } }] });
  if (!built.success) throw new Error("expected order");
  const render = (order: OrderAggregate) => {
    const router = createMemoryRouter([{ id: "detail", path: "/", element: createElement(OrderDetail), loader: () => null }], {
      hydrationData: { loaderData: { detail: { order: toOrderAggregateJson(order, null), base: "/es-PE/orders", manualPaymentId: id(5), receiptUrls: {},
        settings: null, settingsPath: "/es-PE/settings/delivery", link: { kind: "unavailable" } } } } });
    try { return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))); }
    finally { router.dispose(); }
  };
  expect(render(built.data)).toContain("Imprimir rótulo</button>");
  expect(render({ ...built.data, cancelled: true })).toContain("Imprimir rótulo");
});

test("loader resolves receipt urls for rejected payments with one image lookup", async () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const built = buildPendingOrder({ id: id(2) as OrderId, companyId: companyId as CompanyId, number: 1042 as OrderNumber, sellerId: "authenticated-seller" as UserId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-17T12:00:00Z"),
    items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Polo", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 45, currency: "PEN" } }] });
  if (!built.success) throw new Error("expected order");
  const reportedAt = new Date("2026-10-17T13:00:00Z");
  const rejected = (n: number, receipt: number) => ({ id: id(n), orderId: id(2), status: "rejected" as const, currency: "PEN" as const, amount: null, method: null,
    data: { report: { receiptImageId: id(receipt), reportedAt }, rejectedAt: reportedAt, rejectedBy: "authenticated-seller", reason: null } });
  const reported = { id: id(8), orderId: id(2), status: "reported" as const, currency: "PEN" as const, amount: null, method: null, data: { receiptImageId: id(30), reportedAt } };
  const order = { ...built.data, payments: [rejected(6, 20), rejected(7, 21), reported] } as unknown as OrderAggregate;
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(order));
  vi.spyOn(orders, "checkoutUrl").mockResolvedValue(ok(`https://fantasio.yoyos.lat/checkout/${id(2)}`));
  vi.spyOn(deliverySettings, "get").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "unavailable" }));
  vi.mocked(resolvePublicImages).mockResolvedValue(ok({ images: [{ id: id(20), url: "https://cdn.example/20.png" }, { id: id(30), url: "https://cdn.example/30.png" }], failures: [] }));
  const result = await loader({ ...args(), request: new Request(`http://localhost/es-PE/orders/${orderId}`) } as never);
  expect(resolvePublicImages).toHaveBeenCalledTimes(1);
  expect(resolvePublicImages).toHaveBeenCalledWith(expect.arrayContaining([id(20), id(21), id(30)]));
  expect(result.receiptUrls).toEqual({ [id(6)]: "https://cdn.example/20.png", [id(8)]: "https://cdn.example/30.png" });
});

test("order detail labels a rejected payment as Pago rechazado and never as confirmed", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const built = buildPendingOrder({ id: id(2) as OrderId, companyId: companyId as CompanyId, number: 1042 as OrderNumber, sellerId: "seller" as UserId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-17T12:00:00Z"),
    items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Polo", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 45, currency: "PEN" } }] });
  if (!built.success) throw new Error("expected order");
  const at = new Date("2026-10-17T13:00:00Z");
  const order = { ...built.data, payments: [{ id: id(6), orderId: id(2), status: "rejected", currency: "PEN", amount: null, method: null,
    data: { report: { receiptImageId: id(20), reportedAt: at }, rejectedAt: at, rejectedBy: "seller", reason: "No coincide" } }] } as unknown as OrderAggregate;
  const router = createMemoryRouter([{ id: "detail", path: "/", element: createElement(OrderDetail), loader: () => null }], {
    hydrationData: { loaderData: { detail: { order: toOrderAggregateJson(order, null), base: "/es-PE/orders", manualPaymentId: id(5),
      receiptUrls: { [id(6)]: "https://cdn.example/20.png" }, settings: null, settingsPath: "/es-PE/settings/delivery", link: { kind: "unavailable" } } } } });
  try {
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router })));
    expect(html).toContain("Pago rechazado");
    expect(html).not.toContain("Pago confirmado");
  } finally { router.dispose(); }
});

const builtOrder = () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const built = buildPendingOrder({ id: id(2) as OrderId, companyId: companyId as CompanyId, number: 1042 as OrderNumber, sellerId: "seller" as UserId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-17T12:00:00Z"),
    items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Polo", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 45, currency: "PEN" } }] });
  if (!built.success) throw new Error("expected order");
  return { order: built.data, id };
};

test("reject action rejects the report and returns the updated order", async () => {
  const { order, id } = builtOrder();
  const reject = vi.spyOn(orders, "rejectPayment").mockResolvedValue(ok({ order, applied: true }));
  const enable = vi.spyOn(orders, "enableCheckout");
  const result = await action(args({ operation: "reject", paymentId: id(6), reason: "El monto no coincide" }));
  expect(result).toMatchObject({ url: null, success: true, error: false, order: { id: orderId } });
  expect(reject).toHaveBeenCalledWith({ orderId, paymentId: id(6), reason: "El monto no coincide" }, { companyId, userId: "authenticated-seller" });
  expect(enable).not.toHaveBeenCalled();
  await action(args({ operation: "reject", paymentId: id(6), reason: "" }));
  expect(reject).toHaveBeenLastCalledWith({ orderId, paymentId: id(6), reason: "" }, { companyId, userId: "authenticated-seller" });
  expect(await action(args({ operation: "reject", paymentId: "not-a-uuid" }))).toMatchObject({ success: false, error: "INVALID_INPUT" });
});

test("approve and reject map PAYMENT_CONFLICT to the already-reviewed message", async () => {
  const { id } = builtOrder();
  for (const code of ["PAYMENT_CONFLICT", "INVALID_TRANSITION"] as const) {
    vi.spyOn(orders, "rejectPayment").mockResolvedValue(err({ code, message: "Reviewed" }));
    vi.spyOn(orders, "registerPayment").mockResolvedValue(err({ code, message: "Reviewed" }));
    expect(await action(args({ operation: "reject", paymentId: id(6), reason: "" }))).toMatchObject({ success: false, error: "ALREADY_REVIEWED" });
    expect(await action(args({ operation: "confirm", paymentId: id(6), source: "buyer_report", amount: "70", currency: "PEN", method: "digital_wallet" })))
      .toMatchObject({ success: false, error: "ALREADY_REVIEWED" });
  }
  expect(paymentErrorKey("ALREADY_REVIEWED")).toBe("orders.paymentAlreadyReviewed");
  expect(paymentErrorKey("INSUFFICIENT_STOCK")).toBe("orders.paymentStockError");
  expect(paymentErrorKey("NO_RESPONSE")).toBe("orders.paymentUncertain");
});

test("receipt thumbnails load lazily with fixed dimensions", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const { order, id } = builtOrder();
  const at = new Date("2026-10-17T13:00:00Z");
  const withReport = { ...order, payments: [{ id: id(6), orderId: id(2), status: "reported", currency: "PEN", amount: null, method: null,
    data: { receiptImageId: id(20), reportedAt: at } }] } as unknown as OrderAggregate;
  const router = createMemoryRouter([{ id: "detail", path: "/", element: createElement(OrderDetail), loader: () => null }], {
    hydrationData: { loaderData: { detail: { order: toOrderAggregateJson(withReport, null), base: "/es-PE/orders", manualPaymentId: id(5),
      receiptUrls: { [id(6)]: "https://cdn.example/20.png" }, settings: null, settingsPath: "/es-PE/settings/delivery", link: { kind: "unavailable" } } } } });
  try {
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router })));
    expect(html).toMatch(/<img[^>]*src="https:\/\/cdn.example\/20.png"[^>]*loading="lazy"[^>]*decoding="async"[^>]*width="56"[^>]*height="80"/);
    expect(html).toContain("Pago por revisar");
    expect(html).toContain("Rechazar pago reportado el");
    expect(html).not.toContain("Comprobante de pago");
  } finally { router.dispose(); }
});

test.each(["confirm", "reject", "void"])("a lost %s response answers NO_RESPONSE so the card reloads and shows the uncertain-result message", async operation => {
  const serverAction = vi.fn(async () => { throw new Error("Lost response"); });
  const request = new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", body: new URLSearchParams({ operation, paymentId: orderId }) });
  const result = await clientAction({ ...args(), request, params: { orderId }, serverAction });
  expect(result).toEqual({ url: null, success: false, error: "NO_RESPONSE" });
  expect(serverAction).toHaveBeenCalledOnce();
  expect(paymentErrorKey("NO_RESPONSE")).toBe("orders.paymentUncertain");
  expect(shouldRevalidate({ actionResult: result, defaultShouldRevalidate: true })).toBe(true);
});
