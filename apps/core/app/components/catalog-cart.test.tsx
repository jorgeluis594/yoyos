// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CatalogCartButton, CatalogCartPanel } from "@core/app/components/catalog-cart";
import { Sheet } from "@core/app/components/ui/sheet";
import { emptyCart, writeCart, type CatalogCartLine } from "@core/app/lib/catalog-cart-storage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1);
const orderId = id(2);
const line = (variantId: string, productName: string, quantity: number): CatalogCartLine => ({ variantId, productId: id(9), quantity,
  price: { amount: 45, currency: "PEN" }, productName, attributes: {}, imageUrl: null });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let container: HTMLDivElement;
let root: Root;
let posts: unknown[];
let answers: Array<() => Promise<Response>>;

beforeEach(() => {
  posts = [];
  answers = [];
  // The price refresh on open fails, so the cart keeps its id; each POST takes the next queued answer.
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return json({}, 503);
    posts.push(JSON.parse(String(init.body)));
    return answers.shift()!();
  }));
  writeCart(companyId, { orderId, lines: [line(id(3), "Polo negro", 2), line(id(4), "Polo beige", 1)] });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root.render(<MemoryRouter><Sheet><CatalogCartPanel companyId={companyId} catalogPath={`/catalogo/${companyId}`} /></Sheet></MemoryRouter>));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (name: string, scope: ParentNode = container) => [...scope.querySelectorAll("button")]
  .find((element) => element.textContent === name || element.getAttribute("aria-label") === name)!;
const click = (element: HTMLElement) => act(async () => { element.click(); });
const lineItem = (productName: string) => [...container.querySelectorAll("li")].find((item) => item.textContent?.includes(productName))!;

test("Reintentar after a lost response resends the same order id", async () => {
  answers.push(() => Promise.reject(new TypeError("network")), () => Promise.resolve(json({ code: "SERVICE_UNAVAILABLE" }, 503)));
  await click(button("Continuar"));
  expect(container.textContent).toContain("No sabemos si tu pedido se creó");
  await click(button("Reintentar"));
  expect(posts).toEqual([expect.objectContaining({ orderId }), expect.objectContaining({ orderId })]);
});

test("a line without enough stock is marked alone and unmarked once its quantity changes", async () => {
  answers.push(() => Promise.resolve(json({ code: "LINES_UNAVAILABLE", issues: [{ variantId: id(3), reason: "insufficient", available: 1 }] }, 409)));
  await click(button("Continuar"));
  expect(lineItem("Polo negro").textContent).toContain("Solo queda 1");
  expect(lineItem("Polo beige").textContent).not.toContain("Solo queda");
  expect(container.textContent).toContain("Algunos productos ya no están disponibles");
  await click(button("Quitar una unidad", lineItem("Polo negro")));
  expect(lineItem("Polo negro").textContent).not.toContain("Solo queda 1");
});

test("ORDER_ID_CONFLICT retries once with a new order id, then shows the generic error", async () => {
  answers.push(() => Promise.resolve(json({ code: "ORDER_ID_CONFLICT" }, 409)), () => Promise.resolve(json({ code: "ORDER_ID_CONFLICT" }, 409)));
  await click(button("Continuar"));
  expect(posts).toHaveLength(2);
  expect(posts[0]).toMatchObject({ orderId });
  expect(posts[1]).not.toMatchObject({ orderId });
  expect(container.textContent).toContain("No pudimos continuar. Vuelve a intentar");
});

test("«Ver productos» in the empty sheet on the catalog closes it and keeps the search", async () => {
  writeCart(companyId, emptyCart(orderId));
  const Search = () => <output>{useLocation().search}</output>;
  act(() => root.render(<MemoryRouter key="catalog" initialEntries={[`/catalogo/${companyId}?q=polo`]}><Search /><CatalogCartButton companyId={companyId} /></MemoryRouter>));
  await click(button("Carrito, 0 unidades"));
  await click(button("Ver productos"));
  expect(container.querySelector("[role=dialog]")).toBeNull();
  expect(container.querySelector("output")!.textContent).toBe("?q=polo");
});
