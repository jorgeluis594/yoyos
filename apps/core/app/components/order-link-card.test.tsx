// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { OrderLinkCard, orderLinkState, type OrderLinkCardProps } from "@core/app/components/order-link-card";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.unstubAllGlobals(); });

const url = "https://fantasio.yoyos.lat/checkout/7bf00000-0000-4000-8000-000000000001/7bf00000-0000-4000-8000-000000000002";
const ready: OrderLinkCardProps = { state: "pending", link: { kind: "ready", url } };

async function mount(props: OrderLinkCardProps, lng = "es") {
  await i18n.changeLanguage(lng);
  const Stub = createRoutesStub([{ path: "*", Component: () => <OrderLinkCard {...props} /> }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/"]} /></I18nextProvider>));
}
const input = () => container.querySelector<HTMLInputElement>("input");
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const openLink = () => container.querySelector<HTMLAnchorElement>('a[aria-label="Abrir enlace en una pestaña nueva"]');

test("with a subdomain it always shows the absolute brand-host URL in a read-only input and the help", async () => {
  await mount(ready);
  expect(container.textContent).toContain("Enlace del pedido");
  expect(container.textContent).toContain("Pendiente de confirmación");
  expect(input()?.value).toBe(url);
  expect(input()?.readOnly).toBe(true);
  expect(container.textContent).toContain("Comparte este enlace con el comprador para que confirme y pague.");
  expect(container.textContent).not.toContain("Obtener enlace");
  expect(container.textContent).not.toContain("Copiar enlace");
  expect(container.textContent).not.toContain("Abrir checkout del pedido");
});

test("a confirmed order says so", async () => {
  await mount({ ...ready, state: "confirmed" });
  expect(container.textContent).toContain("Confirmado por el comprador");
  expect(container.textContent).not.toContain("Pendiente de confirmación");
});

test("the copy icon button copies the URL and announces Enlace copiado politely", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await mount(ready);
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
  await act(async () => button("Copiar enlace")!.click());
  expect(writeText).toHaveBeenCalledWith(url);
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("Enlace copiado");
});

test("a refused copy fails silently", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
  await mount(ready);
  await act(async () => button("Copiar enlace")!.click());
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("the open icon opens the URL in a new tab without opener", async () => {
  await mount(ready);
  const open = openLink();
  expect(open?.getAttribute("href")).toBe(url);
  expect(open?.getAttribute("target")).toBe("_blank");
  expect(open?.getAttribute("rel")).toBe("noopener noreferrer");
});

test("both icon buttons have no visible text", async () => {
  await mount(ready);
  expect(button("Copiar enlace")?.textContent).toBe("");
  expect(openLink()?.textContent).toBe("");
});

test("without a subdomain it guides to Apariencia de la tienda and shows no input or icons", async () => {
  await mount({ state: "pending", link: { kind: "subdomain_required", appearancePath: "/es-PE/settings/store-appearance#catalog-publication" } });
  expect(container.textContent).toContain("Elige el link de tu tienda para compartir este pedido.");
  const go = [...container.querySelectorAll("a")].find(link => link.textContent === "Ir a Apariencia de la tienda");
  expect(go?.getAttribute("href")).toBe("/es-PE/settings/store-appearance#catalog-publication");
  expect(input()).toBeNull();
  expect(button("Copiar enlace")).toBeNull();
  expect(openLink()).toBeNull();
  expect(container.textContent).not.toContain("Comparte este enlace");
});

test("a cancelled order keeps only «Pedido cancelado»", async () => {
  await mount({ ...ready, state: "cancelled" });
  expect(container.textContent).toContain("Pedido cancelado");
  expect(input()).toBeNull();
  expect(container.querySelectorAll("button, a")).toHaveLength(0);
  expect(container.textContent).not.toContain("Comparte este enlace");
});

test("an unreadable link shows an error with a retry and no input", async () => {
  await mount({ state: "pending", link: { kind: "unavailable" } });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo obtener el enlace");
  expect(input()).toBeNull();
  expect([...container.querySelectorAll("button")].map(element => element.textContent)).toEqual(["Reintentar"]);
});

test("a retry asks the route for fresh data", async () => {
  const loader = vi.fn(() => null);
  const Stub = createRoutesStub([{ path: "*", Component: () => <OrderLinkCard state="pending" link={{ kind: "unavailable" }} />, loader }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/"]} /></I18nextProvider>));
  expect(loader).toHaveBeenCalledTimes(1);
  await act(async () => [...container.querySelectorAll("button")].find(element => element.textContent === "Reintentar")!.click());
  expect(loader).toHaveBeenCalledTimes(2);
});

test("a completed order the buyer never confirmed has no state line, like the list", async () => {
  await mount({ ...ready, state: null });
  expect(container.textContent).not.toContain("Pendiente de confirmación");
  expect(container.textContent).not.toContain("Confirmado por el comprador");
  expect(input()?.value).toBe(url);
});

test("the state follows the list rule: pending only while active and unconfirmed", () => {
  const order = { cancelled: false, status: "active", checkoutConfirmedAt: null };
  expect(orderLinkState(order)).toBe("pending");
  expect(orderLinkState({ ...order, status: "completed" })).toBeNull();
  expect(orderLinkState({ ...order, status: "completed", checkoutConfirmedAt: "2026-10-17T12:05:00.000Z" })).toBe("confirmed");
  expect(orderLinkState({ ...order, status: "cancelled", cancelled: true })).toBe("cancelled");
  expect(orderLinkState({ ...order, cancelled: true, checkoutConfirmedAt: "2026-10-17T12:05:00.000Z" })).toBe("cancelled");
});

test("a second copy is announced again after the message clears", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
    await mount(ready);
    await act(async () => button("Copiar enlace")!.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Enlace copiado");
    await act(async () => { vi.advanceTimersByTime(3500); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    await act(async () => button("Copiar enlace")!.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Enlace copiado");
  } finally { vi.useRealTimers(); }
});

test("the texts exist in Portuguese", async () => {
  await mount(ready, "pt");
  expect(container.textContent).toContain("Link do pedido");
  expect(button("Copiar link")).not.toBeNull();
  await i18n.changeLanguage("es");
});
