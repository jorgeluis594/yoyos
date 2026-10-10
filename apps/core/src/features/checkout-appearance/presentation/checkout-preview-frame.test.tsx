// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { CheckoutPreviewFrame } from "@core/src/features/checkout-appearance/presentation/checkout-preview-frame";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const draft: PublicCheckoutAppearance = { logoUrl: null, brandColor: "plum", background: "neutral" };
const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources });

describe("CheckoutPreviewFrame", () => {
  let root: Root | undefined;
  let container: HTMLElement;
  beforeEach(() => { container = document.body.appendChild(document.createElement("div")); });
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

  function mount(appearance: PublicCheckoutAppearance) {
    root = createRoot(container);
    render(appearance);
    const iframe = container.querySelector("iframe")!;
    const post = vi.fn();
    Object.defineProperty(iframe, "contentWindow", { value: { postMessage: post } });
    return { iframe, post };
  }
  function render(appearance: PublicCheckoutAppearance) {
    act(() => root!.render(<I18nextProvider i18n={i18n}><CheckoutPreviewFrame appearance={appearance} /></I18nextProvider>));
  }
  const announceReady = (source: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "checkout-appearance:ready" }, origin: window.location.origin, source: source as MessageEventSource }));
  });
  const press = (name: string) => act(() => {
    [...container.querySelectorAll("button")].find((button) => button.textContent === name)!.click();
  });
  const lastUpdate = (post: ReturnType<typeof vi.fn>) => post.mock.calls.at(-1)?.[0];

  test("sends the draft once the preview announces it is ready", () => {
    const { iframe, post } = mount(draft);
    expect(post).not.toHaveBeenCalled();
    announceReady(iframe.contentWindow);
    expect(post).toHaveBeenCalledWith({ type: "checkout-appearance:update", appearance: draft, mode: "light", state: "review" }, window.location.origin);
  });

  test("applies each draft change to the preview", () => {
    const { iframe, post } = mount(draft);
    announceReady(iframe.contentWindow);
    render({ ...draft, brandColor: "ocean" });
    expect(lastUpdate(post).appearance.brandColor).toBe("ocean");
    press("Oscuro");
    expect(lastUpdate(post)).toMatchObject({ mode: "dark", state: "review" });
    press("Pago");
    expect(lastUpdate(post)).toMatchObject({ mode: "dark", state: "payment" });
  });

  test("ignores readiness that does not come from its own frame", () => {
    const { post } = mount(draft);
    announceReady(window);
    expect(post).not.toHaveBeenCalled();
  });

  test("keeps the preview from submitting forms and switches device without touching the saved theme", () => {
    const { iframe } = mount(draft);
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(iframe.style.width).toBe("390px");
    press("Escritorio");
    expect(iframe.style.width).toBe("1280px");
    press("Oscuro");
    expect(localStorage.getItem("yoyos-theme")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
