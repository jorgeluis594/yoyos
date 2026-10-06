import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import resources from "@core/app/locales";
import { afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import OrderList, { loader } from "@core/app/routes/order-list";
import { orders } from "@core/src/features/orders/composition";

const context = { get: () => ({ company: { country: "PE", id: "company" }, user: { id: "seller" } }) } as unknown as LoaderFunctionArgs["context"];
const args = (url: string) => ({ request: new Request(url), context }) as LoaderFunctionArgs;

afterEach(() => vi.restoreAllMocks());

test("filters sales by Lima calendar days, including the start and excluding the next midnight", async () => {
  const list = vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items: [], page: 1, pageSize: 20, total: 0 } });
  vi.spyOn(orders, "searchContacts").mockResolvedValue({ success: true, data: [] });

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
    status, paymentStatus, deliveryStatus, total: { amount: 10, currency: "PEN" },
    checkoutEnabledAt: null, deliveredAt: status === "completed" ? createdAt : null,
    completedAt: status === "completed" ? createdAt : null };
  const router = createMemoryRouter([{ id: "orders", path: "/", element: createElement(OrderList), loader: () => null }], {
    hydrationData: { loaderData: { orders: { list: { items: [item], page: 1, pageSize: 20, total: 1 },
      filters: { customer: "all", page: 1 }, contacts: [], customerSearch: "", base: "/es-PE/orders" } } },
  });
  try {
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router })));
    const cell = html.match(/<td[^>]*data-column="createdAt"[^>]*>(.*?)<\/td>/)?.[1];
    expect(cell).toBeDefined();
    expect(cell?.replace(/<[^>]*>/g, "").split(" · ").slice(1).join(" · ")).toBe(expected);
  } finally {
    router.dispose();
  }
});
