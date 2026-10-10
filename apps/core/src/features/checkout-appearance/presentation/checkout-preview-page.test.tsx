// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { PreviewPaymentMethod } from "@core/src/features/checkout-appearance/application/checkout-appearance";
import { CheckoutPreviewPage } from "@core/src/features/checkout-appearance/presentation/checkout-preview-page";
import type { PreviewState } from "@core/src/features/checkout-appearance/presentation/preview-fixtures";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const appearance = { logoUrl: null, brandColor: "forest", background: "white" } as const;
const own: PreviewPaymentMethod[] = [{ method: "digital_wallet", provider: "Plin Lima", holder: "Lima Studio", imageUrl: null }];
const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources });

describe("CheckoutPreviewPage", () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

  async function mount(state: PreviewState, paymentMethods: readonly PreviewPaymentMethod[] | null) {
    const Stub = createRoutesStub([{ path: "/", Component: () =>
      <CheckoutPreviewPage companyName="Lima Studio" appearance={appearance} state={state} paymentMethods={paymentMethods} /> }]);
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub /></I18nextProvider>));
    return container;
  }

  test("labels the page as a preview with sample data", async () => {
    const container = await mount("review", null);
    expect(container.querySelector("[data-slot=preview-bar]")?.textContent).toBe("Vista previa · Datos de ejemplo");
    expect(container.textContent).toContain("Pedido #1001");
  });

  test("never submits the review form nor offers a submit button", async () => {
    const container = await mount("review", null);
    const form = container.querySelector("form")!;
    const submitted = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submitted);
    expect(submitted.defaultPrevented).toBe(true);
    expect([...container.querySelectorAll("button")].every((button) => button.type === "button")).toBe(true);
  });

  test("shows the company's real payment methods in the payment state", async () => {
    const container = await mount("payment", own);
    expect(container.textContent).toContain("Plin Lima");
    expect(container.textContent).not.toContain("datos de ejemplo");
  });

  test("labels the sample payment methods when the company has none", async () => {
    const container = await mount("payment", null);
    expect(container.textContent).toContain("Billetera de ejemplo");
    expect(container.querySelector("[role=note]")?.textContent).toContain("datos de ejemplo");
  });

  test("does not upload a receipt picked in the preview", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const container = await mount("payment", own);
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    const file = new File(["x"], "pago.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Ya pagué")?.disabled).toBe(true);
  });
});
