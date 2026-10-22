// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { StorePreviewFrame } from "@core/app/components/store-preview/store-preview-frame";
import type { StorePreviewMessage } from "@core/app/components/store-preview/store-preview-schemas";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const draft: PublicStoreAppearance = { logoUrl: null, theme: "boutique" };
const card = { id: "p1", name: "Polo", imageUrl: null, price: { kind: "single", amount: { amount: 10, currency: "PEN" } }, soldOut: false } as const;
const loading = { kind: "loading" } as const;
const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources });

describe("StorePreviewFrame", () => {
  let root: Root | undefined;
  let container: HTMLElement;
  beforeEach(() => { container = document.body.appendChild(document.createElement("div")); });
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

  function mount(appearance: PublicStoreAppearance, catalog: StorePreviewMessage["catalog"] = loading) {
    root = createRoot(container);
    render(appearance, catalog);
    const iframe = container.querySelector("iframe")!;
    const post = vi.fn();
    Object.defineProperty(iframe, "contentWindow", { value: { postMessage: post } });
    return { iframe, post };
  }
  function render(appearance: PublicStoreAppearance, catalog: StorePreviewMessage["catalog"] = loading) {
    act(() => root!.render(<I18nextProvider i18n={i18n}><StorePreviewFrame appearance={appearance} catalog={catalog} /></I18nextProvider>));
  }
  const announceReady = (source: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "store-appearance:ready" }, origin: window.location.origin, source: source as MessageEventSource }));
  });
  const press = (name: string) => act(() => {
    [...container.querySelectorAll("button")].find((button) => button.textContent === name)!.click();
  });
  const lastUpdate = (post: ReturnType<typeof vi.fn>) => post.mock.calls.at(-1)?.[0];

  test("sends the theme draft and its own state to the preview", () => {
    const { iframe, post } = mount(draft);
    render({ ...draft, theme: "antojo" });
    expect(lastUpdate(post).appearance.theme).toBe("antojo");
    post.mockClear();
    announceReady(iframe.contentWindow);
    expect(post).toHaveBeenCalledWith({ type: "store-appearance:update", appearance: { ...draft, theme: "antojo" }, surface: "catalog", state: "review", catalog: loading }, window.location.origin);
    press("Checkout");
    press("Pago");
    expect(lastUpdate(post)).toMatchObject({ appearance: { theme: "antojo" }, surface: "checkout", state: "payment" });
  });

  test("opens on Catálogo, keeps the device and the draft when switching surface and shows the review and payment switch only in Checkout", () => {
    const { iframe, post } = mount(draft, { kind: "products", cards: [card] });
    const selector = () => container.querySelector('[role="group"][aria-label="Vista previa"]')!;
    const pressed = (name: string) => [...selector().querySelectorAll("button")].find((element) => element.textContent === name)?.getAttribute("aria-pressed");
    expect(pressed("Catálogo")).toBe("true");
    expect(pressed("Checkout")).toBe("false");
    announceReady(iframe.contentWindow);
    expect(lastUpdate(post)).toMatchObject({ surface: "catalog", catalog: { kind: "products", cards: [card] } });
    expect(container.textContent).not.toContain("Revisión");
    press("Escritorio");
    press("Checkout");
    expect(lastUpdate(post)).toMatchObject({ surface: "checkout", appearance: draft });
    expect(container.textContent).toContain("Revisión");
    press("Catálogo");
    expect(lastUpdate(post)).toMatchObject({ surface: "catalog", appearance: draft });
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(iframe.style.width).toBe("1280px");
  });

  test("the preview label reads Tema Boutique · Tus productos with real cards and Datos de ejemplo with samples", () => {
    const label = () => container.querySelector('[role="status"]')?.textContent;
    mount(draft, { kind: "products", cards: [card] });
    expect(label()).toBe("Tema Boutique · Tus productos");
    render({ ...draft, theme: "noche" }, { kind: "samples" });
    expect(label()).toBe("Tema Noche · Datos de ejemplo");
    render({ ...draft, theme: "noche" }, loading);
    expect(label()).toBe("Tema Noche · Cargando productos");
    press("Checkout");
    expect(label()).toBe("Tema Noche · Datos de ejemplo");
  });

  test("gives the surface options touch targets of at least 44 px", () => {
    mount(draft);
    const options = [...container.querySelectorAll('[role="group"][aria-label="Vista previa"] button')];
    expect(options).toHaveLength(2);
    for (const option of options) expect(option.className).toContain("min-h-touch");
  });

  test("offers phone and desktop and review and payment, and no light or dark switch", () => {
    mount(draft);
    press("Checkout");
    const names = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(names).toEqual(expect.arrayContaining(["Celular", "Escritorio", "Revisión", "Pago"]));
    expect(names).not.toContain("Claro");
    expect(names).not.toContain("Oscuro");
    expect(container.querySelector('[role="group"][aria-label="Modo"]')).toBeNull();
  });

  test("ignores readiness that does not come from its own frame", () => {
    const { post } = mount(draft);
    const sent = post.mock.calls.length;
    announceReady(window);
    expect(post.mock.calls.length).toBe(sent);
  });

  test("keeps the preview from submitting forms and switches device without touching the saved theme", () => {
    const { iframe } = mount(draft);
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(iframe.style.width).toBe("390px");
    press("Escritorio");
    expect(iframe.style.width).toBe("1280px");
    expect(localStorage.getItem("yoyos-theme")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
