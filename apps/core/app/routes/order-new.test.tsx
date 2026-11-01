// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, data, redirect, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import OrderNew from "@core/app/routes/order-new";
import { catalogPaymentOptions } from "@core/src/features/orders/presentation/payment-options";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

const orderId = "00000000-0000-4000-8000-000000001042";
const variantId = "00000000-0000-4000-8000-000000000003";
const crown = { id: "00000000-0000-4000-8000-000000000002", name: "Corona de Príncipe", currency: "PEN", variants: [{ id: variantId, sku: null, attributes: {}, price: 25, stock: 12 }] };
let root: Root | undefined;
let container: HTMLDivElement;

afterEach(() => { act(() => root?.unmount()); root = undefined; container?.remove(); vi.unstubAllGlobals(); });

type Answer = (body: { id: string }) => unknown;
/** «Nueva venta» in a data router with a sales list behind it, so the history entry that Guardar venta leaves can be checked. */
async function mount(action: Answer, fetchOrder: () => Promise<Response> = async () => new Response("{}", { status: 404 })) {
  const submitted: { id: string }[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => String(input).startsWith("/api/orders/catalog") ? new Response(JSON.stringify([crown])) : fetchOrder());
  vi.stubGlobal("fetch", fetchStub);
  const router = createMemoryRouter([
    { path: "/orders", element: <p>Lista de ventas</p> },
    { path: "/orders/new", Component: OrderNew, loader: () => ({ base: "/orders", orderId, currency: "PEN", settings: null, paymentOptions: catalogPaymentOptions }),
      action: async ({ request }) => { const body = JSON.parse(String((await request.formData()).get("order"))); submitted.push(body); return action(body); } },
    { path: "/orders/:id", element: <p>Pedido guardado</p> },
  ], { initialEntries: ["/orders", "/orders/new"], initialIndex: 1 });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
  await vi.waitFor(() => expect(container.textContent).toContain("Nueva venta"));
  return { router, submitted, fetchStub };
}

const button = (name: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((element) => (element.getAttribute("aria-label") ?? element.textContent)?.trim().startsWith(name));
const click = async (element: Element | undefined) => act(async () => { (element as HTMLElement).click(); });
async function addCrown() {
  await click(button("Agregar producto"));
  await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')?.textContent).toContain("Corona de Príncipe"));
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="listbox"] button')].find((element) => element.textContent === "Agregar"));
  await click(button("Listo"));
}
async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

test("replaces the history entry after Guardar venta so back opens Ventas", async () => {
  const { router, submitted } = await mount((body) => redirect(`/orders/${body.id}`));
  await addCrown();
  await click(button("Guardar venta"));
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/orders/${orderId}`));
  expect(submitted).toEqual([expect.objectContaining({ id: orderId, items: [{ variantId, quantity: 1 }] })]);
  await act(async () => { await router.navigate(-1); });
  expect(router.state.location.pathname).toBe("/orders");
});

test("resolves an in-doubt Guardar venta by reading the order with the same id", async () => {
  const fetchOrder = vi.fn(async () => new Response(JSON.stringify({ id: orderId }), { status: 200 }));
  const { router, fetchStub } = await mount(() => data({ lost: "in-doubt" }, { status: 503 }), fetchOrder);
  await addCrown();
  await click(button("Guardar venta"));
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/orders/${orderId}`));
  expect(fetchStub.mock.calls.map(([input]) => String(input))).toContain(`/api/orders/${orderId}/aggregate`);
  await act(async () => { await router.navigate(-1); });
  expect(router.state.location.pathname).toBe("/orders");
});

test("keeps the form and the same order id when the check finds no order, so saving again never makes a second order", async () => {
  const { submitted } = await mount(() => data({ lost: "in-doubt" }, { status: 503 }));
  await addCrown();
  await click(button("Guardar venta"));
  await vi.waitFor(() => expect(button("Guardar venta")!.disabled).toBe(false));
  expect(container.textContent).not.toContain("Verificando");
  expect(container.textContent).toContain("Corona de Príncipe");
  await click(button("Guardar venta"));
  await vi.waitFor(() => expect(submitted).toHaveLength(2));
  expect(submitted.map((body) => body.id)).toEqual([orderId, orderId]);
});

test("blocks saving and leaving while the in-doubt check is running and offers Comprobar de nuevo when it fails", async () => {
  let answer: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => { answer = resolve; });
  let calls = 0;
  const { router } = await mount(() => data({ lost: "in-doubt" }, { status: 503 }), () => ++calls === 1 ? pending : Promise.reject(new TypeError("offline")));
  await addCrown();
  await click(button("Guardar venta"));
  await vi.waitFor(() => expect(container.textContent).toContain("No sabemos si la venta se guardó. Verificando…"));
  expect(button("Guardar venta")!.disabled).toBe(true);
  await act(async () => { void router.navigate("/orders"); });
  expect(document.body.textContent).toContain("Puede que no se haya guardado. ¿Salir igualmente?");
  expect(router.state.location.pathname).toBe("/orders/new");
  await click(button("Quedarme"));
  await act(async () => answer(new Response("boom", { status: 500 })));
  await vi.waitFor(() => expect(container.textContent).toContain("No pudimos comprobar si se guardó."));
  expect(button("Guardar venta")!.disabled).toBe(true);
  await click(button("Comprobar de nuevo"));
  await vi.waitFor(() => expect(container.textContent).toContain("No pudimos comprobar si se guardó."));
});

test("marks the missing phone, sends nothing and focuses it when only the customer's name is typed", async () => {
  const { submitted } = await mount((body) => redirect(`/orders/${body.id}`));
  await addCrown();
  await type("#customer-name", "Ana");
  await click(button("Guardar venta"));
  expect(submitted).toHaveLength(0);
  expect(container.textContent).toContain("No se guardó: revisa 1 campo marcado.");
  expect(container.textContent).toContain("Completa nombre y celular, o deja ambos vacíos.");
  expect(document.activeElement?.id).toBe("customer-phone");
});

test("marks the line of a variant that is no longer available and keeps everything else", async () => {
  await mount(() => ({ code: "VARIANT_NOT_FOUND", error: "private", variantId }));
  await addCrown();
  await type("#customer-name", "");
  await click(button("Guardar venta"));
  await vi.waitFor(() => expect(container.textContent).toContain("Corona de Príncipe ya no está disponible."));
  expect(container.querySelector(`#order-line-${variantId}`)).not.toBeNull();
  expect(document.activeElement?.closest(`#order-line-${variantId}`)).not.toBeNull();
  expect(button("Guardar venta")!.disabled).toBe(false);
});

test("clears an earlier refusal when the next save is refused for an invalid field", async () => {
  await mount(() => ({ code: "PERSISTENCE_UNAVAILABLE", error: "private" }));
  await addCrown();
  await click(button("Guardar venta"));
  await vi.waitFor(() => expect(container.textContent).toContain("No se pudo completar la venta"));
  await type("input[data-quantity]", "");
  await click(button("Guardar venta"));
  expect(container.textContent).not.toContain("No se pudo completar la venta");
  expect(container.textContent).toContain("No se guardó: revisa");
});

test("asks to confirm before leaving a started sale and keeps it on Seguir editando", async () => {
  const { router } = await mount((body) => redirect(`/orders/${body.id}`));
  await addCrown();
  await act(async () => { void router.navigate("/orders"); });
  expect(document.body.textContent).toContain("¿Descartar los cambios?");
  await click(button("Seguir editando"));
  expect(router.state.location.pathname).toBe("/orders/new");
  expect(container.textContent).toContain("Corona de Príncipe");
});

test("empties the view when the seller discards the sale", async () => {
  await mount((body) => redirect(`/orders/${body.id}`));
  await addCrown();
  await click(button("Descartar"));
  await click(button("Descartar venta"));
  expect(container.textContent).toContain("Aún no hay productos");
  expect(button("Descartar")!.disabled).toBe(true);
});
