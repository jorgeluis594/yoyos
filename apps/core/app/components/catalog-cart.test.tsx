// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CatalogCartButton, CatalogCartPanel, resetOrderCheck } from "@core/app/components/catalog-cart";
import { Sheet } from "@core/app/components/ui/sheet";
import { emptyCart, readCart, writeCart, type CatalogCartLine } from "@core/app/lib/catalog-cart-storage";

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
  resetOrderCheck();
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
  act(() => root.render(<MemoryRouter><Sheet><CatalogCartPanel companyId={companyId} catalogPath="/" /></Sheet></MemoryRouter>));
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

test("a line shows its combination in today's «M · Azul» format", () => {
  act(() => writeCart(companyId, { orderId, lines: [{ ...line(id(3), "Polo negro", 1), attributes: { Talla: "M", Color: "Azul" } }] }));
  act(() => root.render(<MemoryRouter><Sheet><CatalogCartPanel companyId={companyId} catalogPath="/" /></Sheet></MemoryRouter>));
  expect(lineItem("Polo negro").textContent).toContain("M · Azul");
});

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

test("a deactivated or deleted variant is marked «Ya no está disponible» on its line alone and the cart is kept", async () => {
  answers.push(() => Promise.resolve(json({ code: "LINES_UNAVAILABLE", issues: [{ variantId: id(4), reason: "unavailable" }] }, 409)));
  await click(button("Continuar"));
  expect(lineItem("Polo beige").textContent).toContain("Ya no está disponible");
  expect(lineItem("Polo negro").textContent).not.toContain("Ya no está disponible");
  expect(container.textContent).toContain("Algunos productos ya no están disponibles");
  expect(lineItem("Polo negro")).toBeDefined();
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
  act(() => root.render(<MemoryRouter key="catalog" initialEntries={["/?q=polo"]}><Search /><CatalogCartButton companyId={companyId} /></MemoryRouter>));
  await click(button("Carrito, 0 unidades"));
  await click(button("Ver productos"));
  expect(container.querySelector("[role=dialog]")).toBeNull();
  expect(container.querySelector("output")!.textContent).toBe("?q=polo");
});

test("Continuar on a hidden catalog says the store stopped taking orders and keeps the cart", async () => {
  answers.push(() => Promise.resolve(json({ code: "CATALOG_UNAVAILABLE" }, 409)));
  await click(button("Continuar"));
  expect(container.textContent).toContain("Esta tienda ya no está recibiendo pedidos por el catálogo");
  expect(lineItem("Polo negro")).toBeDefined();
  expect(lineItem("Polo beige")).toBeDefined();
});

test("cart lines show the theme thumbnail shape with the product initial when the photo is missing", () => {
  const thumbnails = [...container.querySelectorAll<HTMLElement>('li[data-store-part="cart-line"] [data-slot="product-thumbnail"]')];
  expect(thumbnails.map((thumbnail) => thumbnail.textContent)).toEqual(["P", "P"]);
  for (const thumbnail of thumbnails) {
    expect(thumbnail.style.borderRadius).toBe("var(--store-thumb-radius, 0.375rem)");
    expect(thumbnail.style.filter).toBe("var(--store-thumb-filter, none)");
    expect(thumbnail.querySelector("img")).toBeNull();
  }
});

test("Continuar navigates to the full checkout URL on the app host and marks the cart as continued", async () => {
  const checkoutUrl = `https://app.yoyos.lat/checkout/${orderId}`;
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  answers.push(() => Promise.resolve(json({ checkoutUrl })));
  await click(button("Continuar"));
  expect(posts).toEqual([{ intent: "continue", orderId, lines: [{ variantId: id(3), quantity: 2 }, { variantId: id(4), quantity: 1 }] }]);
  expect(assign).toHaveBeenCalledWith(checkoutUrl);
  expect(readCart(companyId)).toMatchObject({ orderId, continued: true });
});

test("a cart whose order id rotates after the conflict retry is not marked continued", async () => {
  answers.push(() => Promise.resolve(json({ code: "ORDER_ID_CONFLICT" }, 409)), () => Promise.resolve(json({ code: "SERVICE_UNAVAILABLE" }, 503)));
  writeCart(companyId, { orderId, lines: [line(id(3), "Polo negro", 2)], continued: true });
  await click(button("Continuar"));
  expect(readCart(companyId).continued).toBeFalsy();
});

describe("order check", () => {
  let checks: unknown[];
  let reply: () => Promise<Response>;
  const mountButton = () => act(() => root.render(<MemoryRouter><CatalogCartButton companyId={companyId} /></MemoryRouter>));
  const pageshow = (persisted: boolean) => act(async () => { window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted })); });
  const settle = () => act(async () => { await Promise.resolve(); });

  beforeEach(() => {
    checks = [];
    reply = () => Promise.resolve(json({ order: "not_confirmed" }));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { checks.push(JSON.parse(String(init.body))); return reply(); }
      return json({ variants: [] });
    }));
  });

  test("checks the order once per document load and on pageshow persisted when the continued cart has lines, and empties it only on confirmed", async () => {
    writeCart(companyId, { orderId, lines: [line(id(3), "Polo negro", 2)], continued: true });
    await mountButton();
    await settle();
    expect(checks).toEqual([{ intent: "check_order", orderId }]);
    await mountButton();
    await act(async () => root.render(<MemoryRouter key="again"><CatalogCartButton companyId={companyId} /></MemoryRouter>));
    expect(checks).toHaveLength(1);
    await pageshow(false);
    expect(checks).toHaveLength(1);
    expect(readCart(companyId).lines).toHaveLength(1);
    await pageshow(true);
    expect(checks).toHaveLength(2);
    expect(readCart(companyId).lines).toHaveLength(1);
    reply = () => Promise.resolve(json({ order: "confirmed" }));
    await pageshow(true);
    await settle();
    expect(checks).toHaveLength(3);
    expect(readCart(companyId).lines).toEqual([]);
    await pageshow(true);
    expect(checks).toHaveLength(3);
  });

  test("sends no order check when the cart was never continued", async () => {
    writeCart(companyId, { orderId, lines: [line(id(3), "Polo negro", 2)] });
    await mountButton();
    await pageshow(true);
    writeCart(companyId, emptyCart(orderId));
    await pageshow(true);
    expect(checks).toEqual([]);
  });

  test("keeps the cart when the order check fails or is rate-limited", async () => {
    writeCart(companyId, { orderId, lines: [line(id(3), "Polo negro", 2)], continued: true });
    reply = () => Promise.reject(new TypeError("network"));
    await mountButton();
    await settle();
    reply = () => Promise.resolve(json({ code: "RATE_LIMITED" }, 429));
    await pageshow(true);
    reply = () => Promise.resolve(json({ code: "CATALOG_UNAVAILABLE" }, 409));
    await pageshow(true);
    reply = () => Promise.resolve(new Response("<html>", { status: 200 }));
    await pageshow(true);
    expect(checks).toHaveLength(4);
    expect(readCart(companyId)).toMatchObject({ orderId, continued: true });
    expect(readCart(companyId).lines).toHaveLength(1);
  });

  test("twenty-one storefront page views with a continued cart send one order check", async () => {
    writeCart(companyId, { orderId, lines: [line(id(3), "Polo negro", 2)], continued: true });
    for (let view = 0; view < 21; view++) await act(async () => root.render(<MemoryRouter key={view}><CatalogCartButton companyId={companyId} /></MemoryRouter>));
    expect(checks).toHaveLength(1);
  });
});
