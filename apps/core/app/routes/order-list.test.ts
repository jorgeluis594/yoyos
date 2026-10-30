import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import resources from "@core/app/locales";
import { afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import OrderList, { loader } from "@core/app/routes/order-list";
import { buildPendingOrder, orderStateMachine, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { orders } from "@core/src/features/orders/composition";

const context = { get: () => ({ company: { country: "PE", id: "company" }, user: { id: "seller" } }) } as unknown as LoaderFunctionArgs["context"];
const args = (url: string) => ({ request: new Request(url), context }) as LoaderFunctionArgs;

afterEach(() => vi.restoreAllMocks());

test("filters sales by Lima calendar days, including the start and excluding the next midnight", async () => {
  const list = vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items: [], page: 1, pageSize: 20, total: 0 } });

  const result = await loader(args("http://localhost/es-PE/orders?createdFrom=2026-09-28&createdBefore=2026-09-29"));

  expect(list).toHaveBeenCalledWith({ page: 1, customer: { kind: "all" },
    createdFrom: new Date("2026-09-28T05:00:00.000Z"), createdBefore: new Date("2026-09-29T05:00:00.000Z") },
  { companyId: "company", userId: "seller" });
  expect(result.filters).toMatchObject({ createdFrom: "2026-09-28T05:00:00.000Z", createdBefore: "2026-09-29T05:00:00.000Z" });

  expect((await loader(args("http://localhost/pt-BR/orders"))).base).toBe("/pt-BR/orders");

  await loader(args("http://localhost/es-PE/orders?createdFrom=1990-01-01"));
  expect(list).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" }, createdFrom: new Date("1990-01-01T04:00:00.000Z") },
    { companyId: "company", userId: "seller" });
  await expect(loader(args("http://localhost/es-PE/orders?createdFrom=2026-02-31"))).rejects.toMatchObject({ status: 400 });
});

test.each([
  ["active", "pending", "pending", "Pago pendiente · Entrega: Pendiente"],
  ["active", "paid", "pending", "Pagado · Entrega: Pendiente"],
  ["active", "paid", "shipped", "Pagado · Entrega: Despachada"],
  ["active", "pending", "delivered", "Pago pendiente · Entrega: Entregada"],
  ["cancelled", "pending", "pending", "Cancelado"],
  ["cancelled", "paid", "pending", "Cancelado"],
  ["completed", "paid", "delivered", "Completado"],
  ["completed", "paid", "delivered", "Completado", "es", "2020-01-01T12:00:00.000Z"],
  ["active", "pending", "pending", "Pagamento pendente · Entrega: Pendente", "pt"],
  ["active", "paid", "shipped", "Pago · Entrega: Enviada", "pt"],
  ["cancelled", "pending", "pending", "Cancelado", "pt"],
  ["completed", "paid", "delivered", "Concluído", "pt"],
] as const)("renders %s orders with %s payment and %s delivery", async (status, paymentStatus, deliveryStatus, expected, language = "es", createdAt: string = "2026-09-28T12:00:00.000Z") => {
  const i18n = createInstance();
  await i18n.init({ lng: language, resources });
  const item = { id: "sale", number: 1001, buyer: null, createdAt,
    itemCount: 5, balanceDue: { amount: paymentStatus === "paid" ? 0 : 10, currency: "PEN" },
    status, paymentStatus, deliveryStatus, total: { amount: 10, currency: "PEN" },
    checkoutEnabledAt: null, deliveredAt: status === "completed" ? createdAt : null,
    completedAt: status === "completed" ? createdAt : null };
  const router = createMemoryRouter([{ id: "orders", path: "/", element: createElement(OrderList), loader: () => null }], {
    hydrationData: { loaderData: { orders: { list: { items: [item], page: 1, pageSize: 20, total: 1 },
      filters: { customer: "all", page: 1 }, contacts: [], customerSearch: "", base: "/es-PE/orders" } } },
  });
  try {
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router })));
    const cell = (column: string) => html.match(new RegExp(`<td[^>]*data-column="${column}"[^>]*>(.*?)</td>`))?.[1].replace(/<[^>]*>/g, "");
    expect(cell("createdAt")).toBeDefined();
    expect(cell("createdAt")).not.toMatch(/Pago|Pagamento|Entrega|Cancelado|Completado|Concluído/);
    expect(cell("itemCount")).toBe("5");
    if (status === "active") {
      const [payment, delivery] = expected.split(" · Entrega: ");
      expect(cell("number")).toContain(payment.replace("Pago pendiente", "Por cobrar:").replace("Pagamento pendente", "A receber:"));
      expect(cell("number")).toContain(delivery);
      if (paymentStatus === "pending") expect(cell("number")).toContain(language === "es" ? "Por cobrar:" : "A receber:");
    } else {
      expect(html).toContain(`aria-label="${expected}"`);
      expect(cell("paymentStatus")).toBeUndefined();
      expect(cell("deliveryStatus")).toBeUndefined();
    }
  } finally {
    router.dispose();
  }
});


test.each([["Ana", "unpaid"], ["+51999", "undelivered"], ["#1001", "all"]] as const)("forwards order search %s and %s view with date and customer filters", async (search, view) => {
  const list = vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items: [], page: 2, pageSize: 20, total: 0 } });
  const result = await loader(args(`http://localhost/es-PE/orders?${new URLSearchParams({ search, view, customer: "general_public", page: "2", createdFrom: "2026-09-28" })}`));
  expect(list).toHaveBeenCalledWith({ search, view, customer: { kind: "general_public" }, page: 2, createdFrom: new Date("2026-09-28T05:00:00Z") }, { companyId: "company", userId: "seller" });
  expect(result.filters).toMatchObject({ search, view, page: 2 });
  await expect(loader(args("http://localhost/es-PE/orders?view=invalid"))).rejects.toMatchObject({ status: 400 });
  await expect(loader(args(`http://localhost/es-PE/orders?search=${"x".repeat(121)}`))).rejects.toMatchObject({ status: 400 });
});


test("web list counts units across product lines and shows the remaining balance after a partial payment", async () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const money = (amount: number) => ({ amount, currency: "PEN" as const });
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId,
    sellerId: "seller" as UserId, customer: { kind: "general_public" }, createdAt: new Date("2026-09-28T12:00:00Z"),
    items: [3, 2].map((quantity, index) => ({ id: id(index + 3) as OrderItemId, variantId: id(index + 5) as VariantId,
      productName: "Producto", variantAttributes: {}, sku: null, quantity, unitPrice: money(10) })) });
  expect(built.success).toBe(true);
  if (!built.success) throw new Error(built.error.message);
  const paid = orderStateMachine.registerPayment(built.data, { id: id(7) as PaymentId, orderId: built.data.id,
    status: "confirmed", amount: money(20), method: "digital_wallet", deductStockIfPartial: false, data: { confirmedAt: new Date("2026-09-28T12:00:00Z"),
      confirmedBy: { kind: "seller", userId: "seller" as UserId }, evidence: { kind: "manual" } } });
  expect(paid.success).toBe(true);
  if (!paid.success) throw new Error(paid.error.message);
  vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items: [paid.data], page: 1, pageSize: 20, total: 1 } });
  const result = await loader(args("http://localhost/es-PE/orders"));
  expect(result.list.items[0]).toMatchObject({ itemCount: 5, balanceDue: money(30), total: money(50) });
});

test("list pages make no stock read", async () => {
  const describe = vi.spyOn(orders, "describeStockDue");
  vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items: [], page: 1, pageSize: 20, total: 0 } });
  const result = await loader(args("http://localhost/es-PE/orders"));
  expect(describe).not.toHaveBeenCalled();
  expect(JSON.stringify(result.list)).not.toContain("stockDue");
});

test("order list shows «Desde el catálogo» for catalog orders only", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const item = (number: number, source: string) => ({ id: `sale-${number}`, number, source, buyer: { contactId: null, name: "Ana", phone: "+51987654321" },
    createdAt: "2026-10-17T12:00:00.000Z", itemCount: 1, balanceDue: { amount: 10, currency: "PEN" }, status: "active", paymentStatus: "pending",
    deliveryStatus: "pending", total: { amount: 10, currency: "PEN" }, checkoutEnabledAt: "2026-10-17T12:00:00.000Z",
    checkoutConfirmedAt: "2026-10-17T12:05:00.000Z", deliveredAt: null, completedAt: null });
  const router = createMemoryRouter([{ id: "orders", path: "/", element: createElement(OrderList), loader: () => null }], {
    hydrationData: { loaderData: { orders: { list: { items: [item(1042, "catalog"), item(1043, "manual")], page: 1, pageSize: 20, total: 2 },
      filters: { customer: "all", page: 1 }, contacts: [], customerSearch: "", base: "/es-PE/orders" } } },
  });
  try {
    const rows = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))).split("<tr").slice(2);
    expect(rows[0]).toContain("#1042");
    expect(rows[0]).toContain("Desde el catálogo");
    expect(rows[1]).not.toContain("Desde el catálogo");
  } finally {
    router.dispose();
  }
});

test("web list loader returns the delivery method and district of each stored snapshot without extra reads", async () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const built = (n: number) => {
    const result = buildPendingOrder({ number: (1000 + n) as OrderNumber, id: id(n) as OrderId, companyId: id(2) as CompanyId,
      sellerId: "seller" as UserId, customer: { kind: "general_public" }, createdAt: new Date("2026-09-28T12:00:00Z"),
      items: [{ id: id(n + 20) as OrderItemId, variantId: id(n + 30) as VariantId, productName: "Producto", variantAttributes: {}, sku: null,
        quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  };
  const district = (name: string) => ({ country: "PE", districtCode: "150122", district: name, province: "LIMA METROPOLITANA", department: "LIMA" }) as const;
  const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" } } as const;
  const pricing = { quotationId: id(11), rateId: id(12), optionId: id(13), settingsVersion: 1 };
  const recordedBy = { kind: "buyer" } as const;
  const home = { method: "home", recipient, destination: { ...district("MIRAFLORES"), address: "Av. 1", instructions: null }, pricing, recordedBy };
  const agency = { method: "agency", recipient: { ...recipient, identity: { kind: "document", documentType: "passport", document: "001" } }, destination: district("SURCO"), pricing, courier: { id: id(14), name: "Olva" },
    agency: { id: id(15), name: "Sede", address: "Jr. 1", location: district("LA VICTORIA") }, recordedBy };
  const store = { method: "store", recipient, pickupPoint: { name: "Tienda", address: "Calle 1", instructions: null }, settingsVersion: 1, recordedBy };
  const items = [{ ...built(1), delivery: home }, { ...built(2), delivery: agency }, { ...built(3), delivery: store },
    built(4), { ...built(5), delivery: home, cancelled: true, cancelledAt: new Date("2026-10-01T00:00:00Z") }] as unknown as OrderAggregate[];
  const list = vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items, page: 1, pageSize: 20, total: 5 } });

  const result = await loader(args("http://localhost/es-PE/orders"));

  expect(list).toHaveBeenCalledTimes(1);
  expect(result.list.items.map(({ deliveryMethod, district }) => ({ deliveryMethod, district }))).toEqual([
    { deliveryMethod: "home", district: "MIRAFLORES" }, { deliveryMethod: "agency", district: "LA VICTORIA" },
    { deliveryMethod: "pickup", district: null }, { deliveryMethod: "none", district: null },
    { deliveryMethod: "home", district: "MIRAFLORES" },
  ]);
});

test("«Pendiente de confirmación» only marks active orders the buyer has not confirmed", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const item = (number: number, status: string, confirmed: boolean) => ({ id: `sale-${number}`, number, source: "manual", buyer: null,
    createdAt: "2026-10-17T12:00:00.000Z", itemCount: 1, balanceDue: { amount: 10, currency: "PEN" }, status, paymentStatus: "pending",
    deliveryStatus: "pending", total: { amount: 10, currency: "PEN" }, checkoutEnabledAt: "2026-10-17T12:00:00.000Z",
    checkoutConfirmedAt: confirmed ? "2026-10-17T12:05:00.000Z" : null, deliveredAt: null, completedAt: status === "completed" ? "2026-10-17T12:10:00.000Z" : null });
  const items = [item(1, "active", false), item(2, "active", true), item(3, "completed", false), item(4, "completed", true), item(5, "cancelled", false)];
  const router = createMemoryRouter([{ id: "orders", path: "/", element: createElement(OrderList), loader: () => null }], {
    hydrationData: { loaderData: { orders: { list: { items, page: 1, pageSize: 20, total: 5 }, filters: { customer: "all", page: 1 }, contacts: [], customerSearch: "", base: "/es-PE/orders" } } },
  });
  try {
    const rows = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))).split("<tr").slice(2);
    expect(rows[0]).toContain("Pendiente de confirmación");
    expect(rows[1]).toContain("Confirmado por el comprador");
    expect(rows[2]).not.toContain("Pendiente de confirmación");
    expect(rows[3]).toContain("Confirmado por el comprador");
    expect(rows[4]).not.toContain("Pendiente de confirmación");
  } finally {
    router.dispose();
  }
});
