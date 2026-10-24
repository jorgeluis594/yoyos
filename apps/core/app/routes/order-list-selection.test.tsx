// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import OrderList from "@core/app/routes/order-list";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

type Method = "home" | "agency" | "pickup" | "none";
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const sale = (number: number, deliveryMethod: Method = "home", status: "active" | "cancelled" = "active") => ({
  id: id(number), number, source: "manual", status, paymentStatus: "pending", deliveryStatus: "pending", checkoutEnabledAt: null, checkoutConfirmedAt: null,
  buyer: null, createdAt: "2026-10-20T15:00:00.000Z", itemCount: 1, total: { amount: 10, currency: "PEN" }, balanceDue: { amount: 10, currency: "PEN" },
  deliveryMethod, district: deliveryMethod === "home" || deliveryMethod === "agency" ? "VILLA EL SALVADOR" : null,
});
const pages: Record<string, ReturnType<typeof sale>[]> = {
  "1": [sale(1), sale(2, "none"), sale(3, "pickup")],
  "2": [sale(4, "agency"), sale(5, "home", "cancelled")],
};
const filters = (view: string) => ({ customer: "all", page: 1, view });
const loaded = (url: URL) => ({ list: { items: pages[url.searchParams.get("page") ?? "1"] ?? [], page: Number(url.searchParams.get("page") ?? 1), pageSize: 3, total: 5 },
  filters: filters(url.searchParams.get("view") ?? "all"), base: "/es-PE/orders" });

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => { container = document.body.appendChild(document.createElement("div")); });
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.unstubAllGlobals(); });

async function mount(initial = "/es-PE/orders?page=1") {
  const router = createMemoryRouter([{ path: "/es-PE/orders", element: <OrderList />, loader: ({ request }) => loaded(new URL(request.url)) }], { initialEntries: [initial] });
  await router.initialize();
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
  return router;
}
const checkbox = (name: string) => container.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${name}"]`)!;
const click = (element: Element) => act(async () => { (element as HTMLElement).click(); });
const bar = () => container.querySelector('[aria-label="Pedidos seleccionados"]');
const barButton = (prefix: string) => [...bar()!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.startsWith(prefix))!;
const goto = async (router: Awaited<ReturnType<typeof mount>>, url: string) => act(async () => { await router.navigate(url); });

test("without a selection there is no bar, and the table shows the district formatted for reading", async () => {
  await mount();

  expect(bar()).toBeNull();
  expect(container.textContent).toContain("Villa El Salvador");
  expect([...container.querySelectorAll("thead th")].map((item) => item.textContent)).toContain("Distrito");
});

test("rows that will be skipped say why and the bar counts every reason and the printable orders", async () => {
  await mount();

  await click(checkbox("Seleccionar los pedidos de esta página"));

  expect(container.textContent).toContain("Falta dirección · se omitirá");
  expect(container.textContent).toContain("Recojo en tienda · se omitirá");
  expect(bar()?.textContent).toContain("3 pedidos seleccionados · 1 sin dirección y 1 de recojo no se imprimirán");
  expect(barButton("Imprimir rótulos").textContent).toBe("Imprimir rótulos (1)");
  expect(barButton("Imprimir rótulos").disabled).toBe(false);
});

test("the page checkbox is indeterminate with some rows, checked with all and unchecking it clears the page", async () => {
  await mount();
  const page = () => checkbox("Seleccionar los pedidos de esta página");

  await click(checkbox("Seleccionar el pedido #1"));
  expect(page().getAttribute("aria-checked")).toBe("mixed");
  await click(page());
  expect(page().getAttribute("aria-checked")).toBe("true");
  await click(page());

  expect(bar()).toBeNull();
  expect(page().getAttribute("aria-checked")).toBe("false");
});

test("the selection survives a page change with its warnings, and Cancelar clears it", async () => {
  const router = await mount();
  await click(checkbox("Seleccionar el pedido #2"));

  await goto(router, "/es-PE/orders?page=2");
  await click(checkbox("Seleccionar el pedido #5"));

  expect(checkbox("Seleccionar el pedido #4").getAttribute("aria-checked")).toBe("false");
  expect(bar()?.textContent).toContain("2 pedidos seleccionados · 1 sin dirección y 1 cancelado no se imprimirán");
  expect(barButton("Imprimir rótulos").disabled).toBe(true);

  await goto(router, "/es-PE/orders?page=1");
  expect(checkbox("Seleccionar el pedido #2").getAttribute("aria-checked")).toBe("true");
  await click(barButton("Cancelar"));
  expect(bar()).toBeNull();
});

test("changing the work view clears the selection", async () => {
  const router = await mount();
  await click(checkbox("Seleccionar el pedido #1"));
  expect(bar()).not.toBeNull();

  await goto(router, "/es-PE/orders?page=1&view=unpaid");

  expect(bar()).toBeNull();
  expect(checkbox("Seleccionar el pedido #1").getAttribute("aria-checked")).toBe("false");
});

test("a single skipped reason reads in the singular and an all-skipped selection cannot be printed", async () => {
  await mount();

  await click(checkbox("Seleccionar el pedido #2"));

  expect(bar()?.textContent).toContain("1 pedido seleccionado · 1 sin dirección no se imprimirá");
  expect(barButton("Imprimir rótulos").textContent).toBe("Imprimir rótulos (0)");
  expect(barButton("Imprimir rótulos").disabled).toBe(true);
});

test("the print button opens the dialog with only the printable orders", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ pdf: null, size: "label_62x100", printed: [], excluded: [], notFound: [] });
  }));
  await mount();
  await click(checkbox("Seleccionar los pedidos de esta página"));

  await click(barButton("Imprimir rótulos"));

  expect(requests).toEqual([{ orderIds: [id(1)], size: "label_62x100" }]);
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Imprimir rótulos");
});

test("the narrow-screen control selects the page like the header checkbox and mirrors its state", async () => {
  await mount();
  const narrow = () => container.querySelector<HTMLElement>('[role="checkbox"][aria-label="Seleccionar página"]')!;

  await click(narrow());
  expect(bar()?.textContent).toContain("3 pedidos seleccionados");
  expect(narrow().getAttribute("aria-checked")).toBe("true");
  expect(checkbox("Seleccionar los pedidos de esta página").getAttribute("aria-checked")).toBe("true");

  await click(checkbox("Seleccionar el pedido #1"));
  expect(narrow().getAttribute("aria-checked")).toBe("mixed");
  await click(narrow());
  await click(narrow());
  expect(bar()).toBeNull();
});
