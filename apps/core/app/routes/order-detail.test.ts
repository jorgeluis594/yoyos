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
import { paymentRecordedKey } from "@core/src/features/orders/presentation/stock-due";

vi.mock("@core/src/shared/images", async (importOriginal) => ({ ...await importOriginal<typeof import("@core/src/shared/images")>(), resolvePublicImages: vi.fn() }));

const testRevisions = { items: "A".repeat(43), customer: "B".repeat(43), delivery: "C".repeat(43) };
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
  vi.spyOn(orders, "lineCatalog").mockResolvedValue(null);
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
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(aggregate({ cancelled: true, cancelledAt: new Date("2026-10-01T00:00:00Z") })));
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

test("order detail names the origin in the subtitle, drops the «Desde el catálogo» badge and never prints the seller id", async () => {
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
        settings: null, settingsPath: "/es-PE/settings/delivery", revisions: testRevisions, lineCatalog: null, link: { kind: "ready", url: "https://fantasio.yoyos.lat/checkout/7bf00000-0000-4000-8000-000000000002" } } } } });
    try { return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))); }
    finally { router.dispose(); }
  };
  const fromCatalog = render({ ...catalog.data, checkoutConfirmedAt: new Date("2026-10-17T12:05:00Z") });
  expect(fromCatalog).toContain("Pedido desde el catálogo");
  expect(fromCatalog).not.toContain(seller);
  const fromSeller = render(manual.data);
  expect(fromSeller).toContain("Registrado por el vendedor");
  expect(fromSeller).not.toContain("Pedido desde el catálogo");
  expect(fromSeller).not.toContain(seller);
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
        settings: null, settingsPath: "/es-PE/settings/delivery", revisions: testRevisions, lineCatalog: null, link: { kind: "unavailable" } } } } });
    try { return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))); }
    finally { router.dispose(); }
  };
  expect(render(built.data)).toContain("Imprimir rótulo</button>");
  expect(render({ ...built.data, cancelled: true, cancelledAt: new Date("2026-10-01T00:00:00Z") })).toContain("Imprimir rótulo");
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
      receiptUrls: { [id(6)]: "https://cdn.example/20.png" }, settings: null, settingsPath: "/es-PE/settings/delivery", revisions: testRevisions, lineCatalog: null, link: { kind: "unavailable" } } } } });
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
      receiptUrls: { [id(6)]: "https://cdn.example/20.png" }, settings: null, settingsPath: "/es-PE/settings/delivery", revisions: testRevisions, lineCatalog: null, link: { kind: "unavailable" } } } } });
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

const stockId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const camisa = stockId(41);
const polo = stockId(42);
type StockDueJson = ReturnType<typeof toOrderAggregateJson>["stockDue"];
/** A paid order of 4 Camisa (M · Azul) and 2 Polo (L), rendered as the detail page shows it for the given stock state. */
async function renderStockDetail(patch: { stockDue: StockDueJson; stockDeducted?: boolean; paymentStatus?: "paid" | "pending"; catalog?: boolean }) {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const items = [
    { id: stockId(43) as OrderItemId, variantId: camisa as VariantId, productName: "Camisa", variantAttributes: { Talla: "M", Color: "Azul" } as Record<string, string>, sku: null, quantity: 4, unitPrice: { amount: 30, currency: "PEN" as const } },
    { id: stockId(44) as OrderItemId, variantId: polo as VariantId, productName: "Polo", variantAttributes: { Talla: "L" } as Record<string, string>, sku: null, quantity: 2, unitPrice: { amount: 20, currency: "PEN" as const } },
  ];
  const common = { id: stockId(2) as OrderId, companyId: companyId as CompanyId, number: 1012 as OrderNumber, customer: { kind: "general_public" } as const, createdAt: new Date("2026-10-17T12:00:00Z"), items };
  const built = patch.catalog ? buildPendingCatalogOrder(common) : buildPendingOrder({ ...common, sellerId: "seller" as UserId });
  if (!built.success) throw new Error("expected order");
  const json = toOrderAggregateJson(built.data, null);
  const order = { ...json, paymentStatus: patch.paymentStatus ?? "paid", paidAmount: { amount: 160, currency: "PEN" as const }, balanceDue: { amount: 0, currency: "PEN" as const },
    stockDeducted: patch.stockDeducted ?? false, stockDue: patch.stockDue };
  const router = createMemoryRouter([{ id: "detail", path: "/", element: createElement(OrderDetail), loader: () => null }], {
    hydrationData: { loaderData: { detail: { order, base: "/es-PE/orders", manualPaymentId: stockId(5), receiptUrls: {}, settings: null,
      settingsPath: "/es-PE/settings/delivery", revisions: testRevisions, lineCatalog: null, link: { kind: "unavailable" } } } } });
  try { return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))); }
  finally { router.dispose(); }
}
const waiting = (...items: Array<[string, number]>) => ({ kind: "waiting" as const, shortItems: items.map(([variantId, available]) => ({ variantId, available })) });

test("shows the waiting notice with each short item and its available units", async () => {
  const html = await renderStockDetail({ stockDue: waiting([camisa, 3], [polo, 0]) });
  expect(html).toContain("Esperando stock");
  expect(html).toContain("Camisa (M · Azul): 4 en el pedido, hay 3.");
  expect(html).toContain("Polo (L): 2 en el pedido, hay 0.");
  expect(html).toContain("Se descontará solo cuando haya stock suficiente. Hasta entonces no se puede enviar ni entregar.");
  expect(html).toMatch(/<h2[^>]*>Esperando stock<\/h2>/);
  expect(html.indexOf("Camisa (M · Azul): 4 en el pedido")).toBeLessThan(html.indexOf(">Productos<"));
});

test("shows the deducting notice when every item fits", async () => {
  const html = await renderStockDetail({ stockDue: { kind: "deducting" } });
  expect(html).toMatch(/<h2[^>]*>Descontando stock<\/h2>/);
  expect(html).toContain("Ya hay stock para este pedido; se descontará en menos de un minuto.");
  expect(html).not.toContain("en el pedido, hay");
});

test("shows no notice for deducted or not due orders", async () => {
  for (const patch of [{ stockDue: null, stockDeducted: true }, { stockDue: null, paymentStatus: "pending" as const }]) {
    const html = await renderStockDetail(patch);
    expect(html).not.toContain("Se descontará solo cuando");
    expect(html).not.toContain("se descontará en menos de un minuto");
  }
});

test("shows the stock line in the products card and no Detalles internos", async () => {
  const deducted = await renderStockDetail({ stockDue: null, stockDeducted: true });
  expect(deducted).toContain("Stock descontado");
  expect(deducted).not.toContain("Detalles internos");
  expect(await renderStockDetail({ stockDue: null, paymentStatus: "pending" })).toContain("Stock pendiente");
  // Waiting and deducting are told by the notice under the header and are not repeated in the card.
  for (const stockDue of [waiting([camisa, 3]), { kind: "deducting" as const }]) {
    const html = await renderStockDetail({ stockDue });
    expect(html).not.toContain("Stock descontado");
    expect(html).not.toContain("Stock pendiente");
  }
});

test("disables ship and deliver with the short items as a list", async () => {
  const html = await renderStockDetail({ stockDue: waiting([camisa, 3], [polo, 0]) });
  expect(html).toContain("Para enviar falta stock de Camisa (M · Azul) y Polo (L).");
  expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-describedby="order-status-note"[^>]*>.*?Marcar enviado/);
  const deducting = await renderStockDetail({ stockDue: { kind: "deducting" } });
  expect(deducting).not.toContain("podrás entregarlo en menos de un minuto");
  expect(deducting).not.toMatch(/<button[^>]*aria-disabled="true"[^>]*>[^<]*(<[^b][^>]*>)*[^<]*Marcar enviado/);
});

test("reloads the order when shipping meets short stock", async () => {
  vi.spyOn(orders, "ship").mockResolvedValue(err({ code: "INSUFFICIENT_STOCK", message: "Short" }));
  const result = await action(args({ operation: "ship" }));
  expect(result).toEqual({ operation: "ship", url: null, success: false, error: "INSUFFICIENT_STOCK" });
  expect(shouldRevalidate({ actionResult: result, defaultShouldRevalidate: false })).toBe(true);
  expect(resources.es.translation.orderFulfillment.INSUFFICIENT_STOCK).toBe("No hay stock suficiente para enviar este pedido.");
});

test("reloads the order when delivering meets short stock and the copy names delivering", async () => {
  vi.spyOn(orders, "deliver").mockResolvedValue(err({ code: "INSUFFICIENT_STOCK", message: "Short" }));
  const result = await action(args({ operation: "deliver" }));
  expect(result).toEqual({ operation: "deliver", url: null, success: false, error: "INSUFFICIENT_STOCK" });
  expect(shouldRevalidate({ actionResult: result, defaultShouldRevalidate: false })).toBe(true);
  expect(resources.es.translation.orderFulfillment.DELIVER_INSUFFICIENT_STOCK).toBe("No hay stock suficiente para entregar este pedido.");
  expect(resources.pt.translation.orderFulfillment.DELIVER_INSUFFICIENT_STOCK).toBe("Não há estoque suficiente para entregar este pedido.");
});

test("chooses the payment success text from the returned order", async () => {
  const { order, id } = builtOrder();
  const paymentId = id(6);
  const confirm = vi.spyOn(orders, "registerPayment");
  const fields = { operation: "confirm", paymentId, source: "buyer_report", amount: "80", currency: "PEN", method: "digital_wallet" };
  confirm.mockResolvedValue(ok({ order, stockDue: { kind: "waiting", shortItems: [{ variantId: id(4) as VariantId, available: 3 }] }, outcome: null } as never));
  const short = await action(args(fields));
  expect(short).toMatchObject({ success: true, error: false, recorded: true, order: { stockDue: { kind: "waiting" } } });
  expect(paymentRecordedKey((short as { order: { stockDue: StockDueJson } }).order)).toBe("orders.paymentRecordedWaiting");
  confirm.mockResolvedValue(ok({ order, stockDue: null, outcome: null } as never));
  const deducted = await action(args(fields));
  expect(deducted).toMatchObject({ success: true, recorded: true, order: { stockDue: null } });
  expect(paymentRecordedKey((deducted as { order: { stockDue: StockDueJson } }).order)).toBe("orders.paymentRecorded");
  expect(paymentRecordedKey({ stockDue: { kind: "deducting" } })).toBe("orders.paymentRecorded");
  expect(resources.es.translation.orders.paymentRecordedWaiting).toBe("Pago registrado. El pedido queda esperando stock.");
  expect(resources.es.translation.orders.paymentSaved).toBe("Pago actualizado.");
});

test("a catalog order's notice never says pediste", async () => {
  const html = await renderStockDetail({ catalog: true, stockDue: waiting([camisa, 3]) });
  expect(html).toContain("Camisa (M · Azul): 4 en el pedido, hay 3.");
  expect(html).not.toMatch(/pediste/i);
  const pt = resources.pt.translation;
  expect(JSON.stringify(pt.orderStock)).not.toMatch(/pediste|pediu/i);
});

test("a payment never fails for stock and the dialog no longer has a stock rejection text", () => {
  expect(paymentErrorKey("INSUFFICIENT_STOCK")).toBe("orders.paymentSaveError");
  expect(resources.es.translation.orders).not.toHaveProperty("paymentStockError");
  expect(resources.pt.translation.orders).not.toHaveProperty("paymentStockError");
});

// ---------------------------------------------------------------------------------------------------------------------
// «Guardar cambios»: the loader's extra reads and the save_changes operation

const revisionOf = (letter: string) => letter.repeat(43);
const jsonArgs = (body: unknown) => ({ params: { orderId },
  context: { get: () => ({ company: { id: companyId }, user: { id: "authenticated-seller" } }) },
  request: new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
}) as unknown as ActionFunctionArgs;
const customerBody = { operation: "save_changes", customer: { base: revisionOf("B"), value: { name: "Ana Pérez", phone: "+51977909427" } } };

test("the loader adds the revisions and loads the line catalog in one batched read for all the order's variants", async () => {
  const order = aggregate();
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(order));
  vi.spyOn(orders, "checkoutUrl").mockResolvedValue(ok("https://fantasio.yoyos.lat/checkout/x"));
  const lineCatalog = vi.spyOn(orders, "lineCatalog").mockResolvedValue({ [orderId]: { stock: 3 } });
  const loaded = await loader(loaderArgs());
  expect(lineCatalog).toHaveBeenCalledOnce();
  expect(lineCatalog).toHaveBeenCalledWith(expect.objectContaining({ items: order.items }), "detail_loader");
  expect(loaded.lineCatalog).toEqual({ [orderId]: { stock: 3 } });
  expect(loaded.revisions).toEqual(orders.revisions(order));
});

test("the loader answers an unknown line catalog when the stock read fails or throws, and still loads the order", async () => {
  vi.spyOn(orders, "getAggregate").mockResolvedValue(ok(aggregate()));
  vi.spyOn(orders, "checkoutUrl").mockResolvedValue(ok("https://fantasio.yoyos.lat/checkout/x"));
  const lineCatalog = vi.spyOn(orders, "lineCatalog").mockResolvedValue(null);
  expect(await loader(loaderArgs())).toMatchObject({ lineCatalog: null, order: { id: orderId } });
  lineCatalog.mockRejectedValue(new Error("not a Prisma error"));
  expect(await loader(loaderArgs())).toMatchObject({ lineCatalog: null, order: { id: orderId } });
});

test("dispatches a JSON body by its operation", async () => {
  const edit = vi.spyOn(orders, "edit").mockResolvedValue(err({ code: "ORDER_NOT_FOUND", message: "missing" }));
  expect(await action(jsonArgs(customerBody))).toMatchObject({ operation: "save_changes", code: "ORDER_NOT_FOUND" });
  expect(edit).toHaveBeenCalledWith({ orderId, customer: { base: revisionOf("B"), value: { name: "Ana Pérez", phone: "+51977909427" } } }, { companyId, userId: "authenticated-seller" });
  edit.mockClear();
  // The old delivery body is no longer an operation, and neither is an unknown one.
  expect(await action(jsonArgs({ delivery: { method: "store" }, expectedPrice: { amount: 0, currency: "PEN" } }))).toEqual({ operation: "save_changes", code: "INVALID_INPUT" });
  expect(await action(jsonArgs({ operation: "other" }))).toEqual({ operation: "save_changes", code: "INVALID_INPUT" });
  expect(await action({ ...jsonArgs({}), request: new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }) } as ActionFunctionArgs))
    .toEqual({ operation: "save_changes", code: "INVALID_INPUT" });
  expect(edit).not.toHaveBeenCalled();
});

test("save_changes turns an empty reference into null, passes the pinned revision and answers the saved order with its revisions and line catalog", async () => {
  const order = aggregate();
  const edit = vi.spyOn(orders, "edit").mockResolvedValue(ok({ order, stockDue: null, outcome: null, applied: ["items"] }));
  const lineCatalog = vi.spyOn(orders, "lineCatalog").mockResolvedValue({ [orderId]: { stock: 9 } });
  const lines = [{ variantId: orderId, quantity: 2 }];
  const result = await action(jsonArgs({ operation: "save_changes", items: { base: revisionOf("A"), lines } }));
  expect(edit).toHaveBeenCalledWith({ orderId, items: { base: revisionOf("A"), lines } }, { companyId, userId: "authenticated-seller" });
  expect(lineCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: orderId }), "save_result");
  expect(result).toMatchObject({ operation: "save_changes", applied: ["items"], lineCatalog: { [orderId]: { stock: 9 } }, order: { id: orderId }, revisions: orders.revisions(order) });
});

test("save_changes answers saved with an unknown line catalog when the read after commit fails or throws", async () => {
  vi.spyOn(orders, "edit").mockResolvedValue(ok({ order: aggregate(), stockDue: null, outcome: null, applied: ["customer"] }));
  const lineCatalog = vi.spyOn(orders, "lineCatalog").mockResolvedValue(null);
  expect(await action(jsonArgs(customerBody))).toMatchObject({ operation: "save_changes", applied: ["customer"], lineCatalog: null });
  lineCatalog.mockRejectedValue(new Error("boom"));
  expect(await action(jsonArgs(customerBody))).toMatchObject({ operation: "save_changes", applied: ["customer"], lineCatalog: null });
});

test("answers TOTAL_CHANGED with the current price for a replaced delivery with an outdated expectedPrice and writes nothing", async () => {
  const edit = vi.spyOn(orders, "edit").mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "changed", currentPrice: { amount: 12, currency: "PEN" } } as never));
  const body = { operation: "save_changes", delivery: { base: revisionOf("C"), change: { kind: "replace", expectedPrice: { amount: 8, currency: "PEN" },
    selection: { method: "store", recipient: { name: "Ana", phone: "+51977909427", identity: { kind: "absent" } } } } } };
  expect(await action(jsonArgs(body))).toEqual({ operation: "save_changes", code: "TOTAL_CHANGED", currentPrice: { amount: 12, currency: "PEN" } });
  expect(edit).toHaveBeenCalledOnce();
});

test("maps the conflict, the variant and the lock errors with their extra fields", async () => {
  const edit = vi.spyOn(orders, "edit");
  edit.mockResolvedValue(err({ code: "ORDER_CHANGED", message: "changed", parts: ["items"] }));
  expect(await action(jsonArgs(customerBody))).toEqual({ operation: "save_changes", code: "ORDER_CHANGED", parts: ["items"] });
  edit.mockResolvedValue(err({ code: "VARIANT_NOT_FOUND", message: "gone", variantId: orderId as VariantId }));
  expect(await action(jsonArgs(customerBody))).toEqual({ operation: "save_changes", code: "VARIANT_NOT_FOUND", variantId: orderId });
  for (const code of ["DELIVERY_LOCKED", "ORDER_CANCELLED", "RATE_UNAVAILABLE", "PERSISTENCE_UNAVAILABLE"] as const) {
    edit.mockResolvedValue(err({ code, message: "x" } as never));
    expect(await action(jsonArgs(customerBody))).toEqual({ operation: "save_changes", code });
  }
});

test("a thrown error answers a persistence failure and is logged without personal data", async () => {
  vi.spyOn(orders, "edit").mockRejectedValue(new Error("boom"));
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
  expect(await action(jsonArgs(customerBody))).toEqual({ operation: "save_changes", code: "PERSISTENCE_UNAVAILABLE" });
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "order_edit_request_failed", operation: "edit_order", entryPoint: "web_action", orderId, userId: "authenticated-seller" }), expect.any(String));
  expect(JSON.stringify(error.mock.calls)).not.toContain("Ana");
});

test("does not revalidate after a successful save_changes and uses its result, but revalidates for the lock errors", () => {
  const saved = { operation: "save_changes", applied: ["items"], order: {}, revisions: {}, lineCatalog: null };
  expect(shouldRevalidate({ actionResult: saved, defaultShouldRevalidate: true })).toBe(false);
  for (const code of ["DELIVERY_LOCKED", "ORDER_CANCELLED", "CUSTOMER_REQUIRED"]) expect(shouldRevalidate({ actionResult: { operation: "save_changes", code }, defaultShouldRevalidate: true })).toBe(true);
  for (const code of ["ORDER_CHANGED", "TOTAL_CHANGED", "INVALID_INPUT", "PERSISTENCE_UNAVAILABLE"]) expect(shouldRevalidate({ actionResult: { operation: "save_changes", code }, defaultShouldRevalidate: true })).toBe(false);
  expect(shouldRevalidate({ actionResult: { operation: "save_changes", lost: "in-doubt" }, defaultShouldRevalidate: true })).toBe(false);
  expect(shouldRevalidate({ actionResult: { url: null, success: true, error: false }, defaultShouldRevalidate: true })).toBe(true);
});

test("the client action turns a lost save_changes response into a lost answer that never revalidates", async () => {
  const request = new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(customerBody) });
  const gateway = vi.fn(async () => { throw new Response("bad gateway", { status: 502 }); });
  const lost = await clientAction({ ...args(), request, params: { orderId }, serverAction: gateway });
  expect(lost).toMatchObject({ data: { operation: "save_changes", lost: "in-doubt" }, init: { status: 503 } });
  const offline = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
  expect(await clientAction({ ...args(), request, params: { orderId }, serverAction: offline })).toMatchObject({ data: { operation: "save_changes", lost: "offline" } });
  const refused = vi.fn(async () => ({ operation: "save_changes", code: "ORDER_CHANGED" }) as never);
  expect(await clientAction({ ...args(), request, params: { orderId }, serverAction: refused })).toEqual({ operation: "save_changes", code: "ORDER_CHANGED" });
});
