// @vitest-environment jsdom
import type { BuyerPaymentView } from "@shared/contracts/orders";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { PreviewPaymentMethod } from "@core/src/features/checkout-appearance/application/checkout-appearance";
import { CheckoutPayment, CheckoutShell } from "@core/app/components/checkout-sections";
import { checkoutThemeIds, checkoutThemes } from "@core/src/features/checkout-appearance/domain/checkout-themes";
import { CheckoutPreviewPage } from "@core/src/features/checkout-appearance/presentation/checkout-preview-page";
import { previewCheckout, previewPaymentView, type PreviewState } from "@core/src/features/checkout-appearance/presentation/preview-fixtures";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const appearance = { logoUrl: null, theme: "suave" } as const;
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

  test("renders the confirmed checkout's own sections in the payment state", async () => {
    const container = await mount("payment", own);
    expect(container.textContent).toContain("Para solicitar cambios");
    const details = [...container.querySelectorAll("h2")].find((heading) => heading.textContent === "Datos del comprador")?.parentElement;
    expect(details?.textContent).toContain("Ana Pérez");
    expect(container.querySelector("section[aria-label='Pago del pedido']")).not.toBeNull();
    expect(container.querySelector("header")?.textContent).toContain("Lima Studio");
    expect(container.querySelector("header")?.textContent).toContain("Pedido #1001");
  });

  test("enables confirmation once the sample delivery is selected, as the checkout does", async () => {
    const container = await mount("review", null);
    await act(async () => {});
    const row = (label: string) => [...container.querySelectorAll("dt")].find((term) => term.textContent === label)?.nextElementSibling?.textContent;
    expect(row("Entrega")).toBe("Gratis");
    expect(row("Total a pagar")).toContain("118");
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Confirmar pedido")?.disabled).toBe(false);
  });

  test("shows one sample product with photo and one with the marker", async () => {
    const container = await mount("review", null);
    const thumbnails = [...container.querySelectorAll("[data-slot=product-thumbnail]")];
    expect(thumbnails).toHaveLength(2);
    expect(thumbnails[0]?.querySelector("img")?.getAttribute("src")).toBe("/checkout-preview/sample-product.svg");
    expect(thumbnails[1]?.querySelector("img")).toBeNull();
    expect(thumbnails[1]?.textContent).toBe("O");
  });

  test("puts each payment image on a plate and keeps the method choice themable", async () => {
    const withImage: PreviewPaymentMethod[] = [{ method: "digital_wallet", provider: "Plin Lima", holder: "Lima Studio", imageUrl: "https://cdn.example/qr.png" }];
    const container = await mount("payment", withImage);
    const plate = container.querySelector("[data-checkout-part=payment-image]");
    expect(plate?.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/qr.png");
    const method = container.querySelector("[data-checkout-part=payment-method]");
    expect(method?.querySelector("input[type=radio]")?.getAttribute("data-slot")).toBe("radio-group-item");
  });

  test("gives the native selects and radios of the review the hooks the theme targets", async () => {
    const container = await mount("review", null);
    await act(async () => {});
    expect(container.querySelector("[data-checkout-part=option-group]")).not.toBeNull();
    for (const radio of container.querySelectorAll("input[type=radio]")) expect(radio.getAttribute("data-slot")).toBe("radio-group-item");
    expect(container.querySelector("[data-checkout-part=option]")).not.toBeNull();
  });

  test.each(checkoutThemeIds)("paints the receipts link and the copy buttons with the %s theme's link color", async (theme) => {
    const bank: PreviewPaymentMethod = { method: "bank_transfer", bank: "Banco de ejemplo", holder: "Lima Studio", accountNumber: "000-1", cci: "00000000000000000001", imageUrl: null };
    const view: BuyerPaymentView = { ...previewPaymentView([bank]), payments: [{ id: "00000000-0000-4000-8000-000000000001", status: "reported", amount: null, method: null, receiptImageUrl: "https://cdn.example/recibo.png" }] };
    const Stub = createRoutesStub([{ path: "/", Component: () =>
      <CheckoutShell appearance={{ logoUrl: null, theme }} checkout={previewCheckout("Lima Studio", "payment")}><CheckoutPayment view={view} /></CheckoutShell> }]);
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub /></I18nextProvider>));
    const scoped = container.querySelector("[data-checkout-theme]")!;
    const css = container.querySelector("style")!.textContent!;
    expect(css).toContain(`--link:${checkoutThemes[theme].colors.link}`);
    const receipts = scoped.querySelector<HTMLAnchorElement>("a[href='https://cdn.example/recibo.png']")!;
    const copy = [...scoped.querySelectorAll("button")].filter((button) => button.textContent?.startsWith("Copiar"));
    expect(copy).toHaveLength(2);
    for (const element of [receipts, ...copy]) {
      expect(element.className).toContain("text-[var(--link)]");
      expect(element.className).not.toContain("text-primary");
    }
  });
});
