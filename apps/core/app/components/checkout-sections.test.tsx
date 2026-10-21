// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { describe, expect, test } from "vitest";
import type { CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import { CheckoutBuyerDetails, CheckoutOrderSummary, CheckoutReviewFields, CheckoutShell, checkoutTotal } from "@core/app/components/checkout-sections";
import { checkoutThemeIds } from "@core/src/features/checkout-appearance/domain/checkout-themes";
import { previewCheckout } from "@core/src/features/checkout-appearance/presentation/preview-fixtures";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const withI18n = (element: React.ReactElement) => <I18nextProvider i18n={i18n}>{element}</I18nextProvider>;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pending = previewCheckout("Lima Studio", "review");
const replace = { delivery: { kind: "replace" }, price: { amount: 10, currency: "PEN" } } as unknown as CheckoutDeliveryDraft;
const keep = { delivery: { kind: "keep" }, price: { amount: 0, currency: "PEN" } } as unknown as CheckoutDeliveryDraft;

describe("checkoutTotal", () => {
  test("is the order total once confirmed", () => {
    const confirmed = previewCheckout("Lima Studio", "payment");
    expect(checkoutTotal(confirmed, null)).toEqual(confirmed.total);
  });
  test("is unknown while pending without a delivery choice", () => {
    expect(checkoutTotal(pending, null)).toBeNull();
  });
  test("adds the chosen delivery price to the items while pending", () => {
    expect(checkoutTotal(pending, replace)).toEqual({ amount: 128, currency: "PEN" });
  });
  test("keeps the order total when the saved delivery is kept", () => {
    expect(checkoutTotal(pending, keep)).toEqual(pending.total);
  });
});

describe("CheckoutShell", () => {
  test("puts the brand inside the header with the order title", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(withI18n(<CheckoutShell appearance={null} checkout={pending}><p>Contenido</p></CheckoutShell>)));
    const header = container.querySelector("header")!;
    expect(header.textContent).toContain("Lima Studio");
    expect(header.querySelector("h1")?.textContent).toBe("Pedido #1001");
    act(() => root.unmount());
  });

  test("places the brand with the theme's header justification inside the page width, not on the full-width bar", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(withI18n(<CheckoutShell appearance={null} checkout={pending}><p>Contenido</p></CheckoutShell>)));
    const bar = container.querySelector('[data-checkout-part="header"]')!;
    const row = bar.firstElementChild!;
    expect((row as HTMLElement).getAttribute("style")).toContain("var(--checkout-header-justify");
    expect(row.contains(container.querySelector('[data-checkout-part="header-brand"]'))).toBe(true);
    act(() => root.unmount());
  });
});

describe("CheckoutOrderSummary", () => {
  const withPhotos = {
    ...pending,
    items: [
      { ...pending.items[0]!, productName: "Polo básico", imageUrl: "https://cdn.example/polo.png" },
      { ...pending.items[1]!, productName: "Taza blanca", variantAttributes: {}, imageUrl: null },
    ],
  };

  function render(element: React.ReactElement) {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(withI18n(element)));
    return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
  }

  test("shows a thumbnail at the left of each product row before name, variant, quantity and subtotal", () => {
    const { container, unmount } = render(<CheckoutOrderSummary checkout={withPhotos} deliveryDraft={null} />);
    const rows = [...container.querySelectorAll<HTMLElement>("[data-checkout-part=product-row]")];
    expect(rows).toHaveLength(2);
    const [polo, taza] = rows as [HTMLElement, HTMLElement];
    expect(polo.firstElementChild?.getAttribute("data-slot")).toBe("product-thumbnail");
    expect(polo.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/polo.png");
    expect(taza.firstElementChild?.getAttribute("data-slot")).toBe("product-thumbnail");
    expect(taza.querySelector("img")).toBeNull();
    expect(taza.querySelector("[data-slot=product-thumbnail]")?.textContent).toBe("T");
    expect(polo.querySelector("[data-checkout-part=product-name]")?.textContent).toBe("Polo básico");
    expect(polo.querySelector("[data-checkout-part=product-meta]")?.textContent).toContain("M");
    expect(polo.querySelector("[data-checkout-part=price]")?.textContent).toContain("98");
    expect(polo.textContent).toContain("2 ×");
    unmount();
  });

  test("marks the totals with their theme hooks", () => {
    const { container, unmount } = render(<CheckoutOrderSummary checkout={withPhotos} deliveryDraft={null} />);
    expect(container.querySelector("[data-checkout-part=total] [data-checkout-part=total-label]")?.textContent).toBe("Total a pagar");
    expect(container.querySelector("[data-checkout-part=total-amount]")).not.toBeNull();
    expect(container.querySelectorAll("[data-checkout-part=card]")).toHaveLength(2);
    expect(container.querySelector("[data-checkout-part=section-title]")?.textContent).toBe("Productos");
    unmount();
  });

  const sameText = [
      "Lima Studio", "Pedido #1001", "Revisa los productos y el total de tu pedido.", "Tus datos", "Nombre", "Teléfono",
      "Incluye el código de país, por ejemplo +51987654321.", "Datos del comprador", "Ana Pérez", "+51987654321", "Productos",
      "Polo básico", "M", "2 × S/ 49.00", "S/ 98.00", "Taza blanca", "1 × S/ 20.00", "S/ 20.00", "Subtotal de productos", "S/ 118.00",
      "Entrega", "Selecciona una opción", "Total a pagar", "Selecciona entrega",
    ].join("");

  test.each(checkoutThemeIds)("keeps the same sections, fields and texts in the %s theme", (theme) => {
    const { container, unmount } = render(
      <CheckoutShell appearance={{ logoUrl: null, theme }} checkout={withPhotos} summary={<CheckoutOrderSummary checkout={withPhotos} deliveryDraft={null} />}>
        <CheckoutReviewFields message={null} name={{ defaultValue: "Ana" }} phone={{ defaultValue: "+51987654321" }} delivery={null} />
        <CheckoutBuyerDetails buyer={withPhotos.buyer} />
      </CheckoutShell>);
    // The thumbnails are the only content a theme adds, so their initials are left out, and so is the theme's stylesheet.
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-slot=product-thumbnail], style").forEach((added) => added.remove());
    expect(clone.textContent?.replaceAll("\u00a0", " ")).toBe(sameText);
    const group = container.querySelector("[data-checkout-part=field-group]")!;
    expect(group.querySelectorAll("[data-checkout-part=field]")).toHaveLength(2);
    expect(group.querySelectorAll("input")).toHaveLength(2);
    expect(container.querySelector("[data-checkout-part=header]")?.querySelector("[data-checkout-part=header-brand]")).not.toBeNull();
    expect(container.querySelector("h1[data-checkout-part=order-title]")?.textContent).toBe("Pedido #1001");
    unmount();
  });
});
