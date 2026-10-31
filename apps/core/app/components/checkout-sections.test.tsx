// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { describe, expect, test } from "vitest";
import type { CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import { CheckoutBuyerDetails, CheckoutOrderSummary, CheckoutReviewFields, CheckoutShell, checkoutTotal } from "@core/app/components/checkout-sections";
import { storeThemeIds } from "@shared/store-themes";
import { previewCheckout } from "@core/src/features/store-appearance/presentation/preview-fixtures";

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

  test("shows no status block of its own: a confirmed checkout has none, and the header notice goes under the title", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const confirmed = previewCheckout("Lima Studio", "payment");
    act(() => root.render(withI18n(<CheckoutShell appearance={null} checkout={confirmed}><p>Contenido</p></CheckoutShell>)));
    expect(container.querySelector("header")?.textContent).not.toContain("Pedido confirmado");
    expect(container.querySelector("[data-store-part=status]")).toBeNull();
    act(() => root.render(withI18n(<CheckoutShell appearance={null} checkout={confirmed} headerNotice={<p>Aviso</p>}><p>Contenido</p></CheckoutShell>)));
    const header = container.querySelector("header")!;
    expect(header.querySelector("h1")!.compareDocumentPosition([...header.querySelectorAll("p")].find((p) => p.textContent === "Aviso")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header.textContent).toContain("Aviso");
    act(() => root.unmount());
  });

  test("places the brand with the theme's header justification inside the page width, not on the full-width bar", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(withI18n(<CheckoutShell appearance={null} checkout={pending}><p>Contenido</p></CheckoutShell>)));
    const bar = container.querySelector('[data-store-part="header"]')!;
    const row = bar.firstElementChild!;
    expect((row as HTMLElement).getAttribute("style")).toContain("var(--store-header-justify");
    expect(row.contains(container.querySelector('[data-store-part="header-brand"]'))).toBe(true);
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
    const rows = [...container.querySelectorAll<HTMLElement>("[data-store-part=product-row]")];
    expect(rows).toHaveLength(2);
    const [polo, taza] = rows as [HTMLElement, HTMLElement];
    expect(polo.firstElementChild?.getAttribute("data-slot")).toBe("product-thumbnail");
    expect(polo.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/polo.png");
    expect(taza.firstElementChild?.getAttribute("data-slot")).toBe("product-thumbnail");
    expect(taza.querySelector("img")).toBeNull();
    expect(taza.querySelector("[data-slot=product-thumbnail]")?.textContent).toBe("T");
    expect(polo.querySelector("[data-store-part=product-name]")?.textContent).toBe("Polo básico");
    expect(polo.querySelector("[data-store-part=product-meta]")?.textContent).toContain("M");
    expect(polo.querySelector("[data-store-part=price]")?.textContent).toContain("98");
    expect(polo.textContent).toContain("2 ×");
    unmount();
  });

  test("keeps today's «M · Azul» format for the copied combination", () => {
    const { container, unmount } = render(<CheckoutOrderSummary checkout={{ ...pending, items: [{ ...pending.items[0]!, variantAttributes: { Talla: "M", Color: "Azul" } }] }} deliveryDraft={null} />);
    expect(container.querySelector("[data-store-part=product-meta]")?.textContent).toBe("M · Azul");
    unmount();
  });

  test("labels the total «Total del pedido» once the checkout is confirmed or cancelled", () => {
    for (const state of [{ kind: "confirmed", confirmedAt: "2026-10-30T12:00:00.000Z" }, { kind: "cancelled" }] as const) {
      const { container, unmount } = render(<CheckoutOrderSummary checkout={{ ...withPhotos, state }} deliveryDraft={null} />);
      expect(container.querySelector("[data-store-part=total-label]")?.textContent).toBe("Total del pedido");
      expect(container.querySelector("section[aria-label='Total del pedido']")).not.toBeNull();
      unmount();
    }
  });

  test("marks the totals with their theme hooks", () => {
    const { container, unmount } = render(<CheckoutOrderSummary checkout={withPhotos} deliveryDraft={null} />);
    expect(container.querySelector("[data-store-part=total] [data-store-part=total-label]")?.textContent).toBe("Total a pagar");
    expect(container.querySelector("[data-store-part=total-amount]")).not.toBeNull();
    expect(container.querySelectorAll("[data-store-part=card]")).toHaveLength(2);
    expect(container.querySelector("[data-store-part=section-title]")?.textContent).toBe("Productos");
    unmount();
  });

  const sameText = [
      "Lima Studio", "Pedido #1001", "Revisa los productos y el total de tu pedido.", "Tus datos", "Nombre", "Teléfono",
      "Datos del comprador", "Ana Pérez · +51987654321", "Productos",
      "Polo básico", "M", "2 × S/ 49.00", "S/ 98.00", "Taza blanca", "1 × S/ 20.00", "S/ 20.00", "Subtotal de productos", "S/ 118.00",
      "Entrega", "Selecciona una opción", "Total a pagar", "Selecciona entrega",
    ].join("");

  test.each(storeThemeIds)("keeps the same sections, fields and texts in the %s theme", (theme) => {
    const { container, unmount } = render(
      <CheckoutShell appearance={{ logoUrl: null, theme }} checkout={withPhotos} summary={<CheckoutOrderSummary checkout={withPhotos} deliveryDraft={null} />}>
        <CheckoutReviewFields message={null} name={{ defaultValue: "Ana" }} phone={{ defaultValue: "+51987654321" }} delivery={null} />
        <CheckoutBuyerDetails buyer={withPhotos.buyer} delivery={withPhotos.delivery} />
      </CheckoutShell>);
    // The thumbnails are the only content a theme adds, so their initials are left out, and so is the theme's stylesheet.
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-slot=product-thumbnail], style, option").forEach((added) => added.remove());
    expect(clone.textContent?.replaceAll("\u00a0", " ")).toBe(sameText);
    const group = container.querySelector("[data-store-part=field-group]")!;
    expect(group.querySelectorAll("[data-store-part=field]")).toHaveLength(2);
    expect(group.querySelectorAll("input")).toHaveLength(2);
    expect(container.querySelector("[data-store-part=header]")?.querySelector("[data-store-part=header-brand]")).not.toBeNull();
    expect(container.querySelector("h1[data-store-part=order-title]")?.textContent).toBe("Pedido #1001");
    unmount();
  });
});

describe("CheckoutReviewFields recipient", () => {
  const setup = (recipient?: Parameters<typeof CheckoutReviewFields>[0]["recipient"]) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    void act(() => root.render(withI18n(<CheckoutReviewFields message={null} name={{ defaultValue: "Ana" }} phone={{ defaultValue: "+51977909427" }} recipient={recipient} delivery={null} />)));
    return { container, unmount: () => root.unmount() };
  };
  const person = { name: { defaultValue: "Luis" }, phone: { defaultValue: "+14155552671" } };

  test("offers no recipient check when the form leaves it out, as in the Apariencia preview", () => {
    const { container, unmount } = setup();
    expect(container.querySelector("[role=checkbox]")).toBeNull();
    unmount();
  });

  test("starts unchecked with the help and without the recipient fields", () => {
    const { container, unmount } = setup({ other: false, onOtherChange: () => undefined, ...person });
    const checkbox = container.querySelector("[role=checkbox]")!;
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector(`label[for=${checkbox.id}]`)?.textContent).toBe("Otra persona recibe el pedido");
    expect(container.textContent).toContain("Si no lo marcas, entregamos a tu nombre y teléfono.");
    expect(checkbox.getAttribute("aria-describedby")).toBeTruthy();
    expect(container.querySelector("#recipient-name")).toBeNull();
    expect(container.querySelector("#recipient-phone")).toBeNull();
    unmount();
  });

  test("checked, asks for the name and phone of who receives with the same country selector", () => {
    const { container, unmount } = setup({ other: true, onOtherChange: () => undefined, ...person });
    expect(container.querySelector("[role=checkbox]")!.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("label[for=recipient-name]")?.textContent).toBe("Nombre de quien recibe");
    expect(container.querySelector("label[for=recipient-phone]")?.textContent).toBe("Teléfono de quien recibe");
    expect(container.querySelector<HTMLInputElement>("#recipient-name")!.required).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#recipient-phone")!.required).toBe(true);
    expect(container.querySelectorAll("select[aria-label='País del teléfono']")).toHaveLength(2);
    unmount();
  });

  test("shows the recipient errors in place and toggles through the check", async () => {
    const changes: boolean[] = [];
    const { container, unmount } = setup({ other: true, onOtherChange: value => changes.push(value), ...person, nameError: "Falta el nombre", phoneError: "Teléfono inválido" });
    expect(container.querySelector("#recipient-name-error")?.textContent).toBe("Falta el nombre");
    expect(container.querySelector("#recipient-phone-error")?.textContent).toBe("Teléfono inválido");
    expect(container.querySelector("#recipient-phone")!.getAttribute("aria-describedby")).toContain("recipient-phone-error");
    await act(async () => container.querySelector<HTMLButtonElement>("[role=checkbox]")!.click());
    expect(changes).toEqual([false]);
    unmount();
  });

  test("the buyer phone has no country-code hint any more", () => {
    const { container, unmount } = setup();
    expect(container.textContent).not.toContain("Incluye el código de país");
    expect(container.querySelector("#buyer-phone")).not.toBeNull();
    unmount();
  });
});

describe("CheckoutBuyerDetails", () => {
  const buyer = { name: "Ana Pérez", phone: "+51987654321" };
  const render = (delivery: Parameters<typeof CheckoutBuyerDetails>[0]["delivery"]) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    void act(() => root.render(withI18n(<CheckoutBuyerDetails buyer={buyer} delivery={delivery} />)));
    return { lines: [...container.querySelectorAll("section div p")].map(line => line.textContent), unmount: () => root.unmount() };
  };

  test("shows the name and phone on the first line and the delivery mode and address on the second", () => {
    const { lines, unmount } = render({ method: "store", recipient: { name: "Ana", phone: "+51987654321", identity: { kind: "absent" } },
      pickupPoint: { name: "Tienda", address: "Av. Lima 123", instructions: null }, settingsVersion: 1 } as never);
    expect(lines).toEqual(["Ana Pérez · +51987654321", "Recojo en tienda · Av. Lima 123"]);
    unmount();
  });

  test("shows a single line while no delivery is saved", () => {
    const { lines, unmount } = render(null);
    expect(lines).toEqual(["Ana Pérez · +51987654321"]);
    unmount();
  });
});
