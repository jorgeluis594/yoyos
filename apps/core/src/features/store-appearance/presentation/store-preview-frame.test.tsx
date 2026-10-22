// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { StorePreviewFrame } from "@core/src/features/store-appearance/presentation/store-preview-frame";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const draft: PublicStoreAppearance = { logoUrl: null, theme: "boutique" };
const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources });

describe("StorePreviewFrame", () => {
  let root: Root | undefined;
  let container: HTMLElement;
  beforeEach(() => { container = document.body.appendChild(document.createElement("div")); });
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

  function mount(appearance: PublicStoreAppearance) {
    root = createRoot(container);
    render(appearance);
    const iframe = container.querySelector("iframe")!;
    const post = vi.fn();
    Object.defineProperty(iframe, "contentWindow", { value: { postMessage: post } });
    return { iframe, post };
  }
  function render(appearance: PublicStoreAppearance) {
    act(() => root!.render(<I18nextProvider i18n={i18n}><StorePreviewFrame appearance={appearance} /></I18nextProvider>));
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
    expect(post).toHaveBeenCalledWith({ type: "store-appearance:update", appearance: { ...draft, theme: "antojo" }, state: "review" }, window.location.origin);
    press("Pago");
    expect(lastUpdate(post)).toMatchObject({ appearance: { theme: "antojo" }, state: "payment" });
  });

  test("offers phone and desktop and review and payment, and no light or dark switch", () => {
    mount(draft);
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
