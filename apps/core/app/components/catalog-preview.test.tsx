import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, test } from "vitest";
import resources from "@core/app/locales";
import { CatalogPreview } from "@core/app/components/catalog-preview";
import type { PreviewCard } from "@core/app/components/store-preview/store-preview-schemas";

const appearance = { logoUrl: null, theme: "noche" } as const;
const card = (name: string, soldOut = false): PreviewCard => ({ id: name, name, imageUrl: null, price: { kind: "single", amount: { amount: 10, currency: "PEN" } }, soldOut });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const html = (catalog: Parameters<typeof CatalogPreview>[0]["catalog"]) => renderToStaticMarkup(<I18nextProvider i18n={i18n}><CatalogPreview appearance={appearance} storeName="Lima Studio" catalog={catalog} /></I18nextProvider>);

describe("CatalogPreview", () => {
  test("the catalog preview shows three placeholders while cards load, then the real cards", () => {
    const loading = html({ kind: "loading" });
    expect(loading.match(/data-slot="card-placeholder"/g)).toHaveLength(3);
    expect(loading).toContain("Cargando productos");
    expect(loading).not.toContain("de ejemplo");
    expect(loading).not.toContain('data-store-part="catalog-card"');
    const loaded = html({ kind: "products", cards: [card("Polo"), card("Casaca")] });
    expect(loaded).not.toContain("Cargando productos");
    expect(loaded).not.toContain("card-placeholder");
    expect(loaded.match(/data-store-part="catalog-card"/g)).toHaveLength(2);
    expect(loaded).toContain("Polo");
    expect(loaded).not.toContain("de ejemplo");
  });

  test("the catalog preview draws the sample cards for the samples kind", () => {
    const samples = html({ kind: "samples" });
    expect(samples.match(/data-store-part="catalog-card"/g)).toHaveLength(3);
    expect(samples).toContain("Producto de ejemplo");
  });

  test("the catalog preview uses the real catalog parts in the draft theme", () => {
    const view = html({ kind: "products", cards: [card("Polo")] });
    expect(view).toContain('data-store-theme-id="noche"');
    for (const part of ["header", "catalog-search", "catalog-card", "catalog-card-photo", "product-name", "price", "cart-button"]) expect(view).toContain(`data-store-part="${part}"`);
    expect(view).toContain("Lima Studio");
  });

  test("the catalog preview cart button stands for the first product that is not sold out and shows no units when all are", () => {
    const badge = (catalog: Parameters<typeof CatalogPreview>[0]["catalog"]) => html(catalog).match(/aria-label="Carrito, ([^"]+)"/)?.[1];
    expect(badge({ kind: "products", cards: [card("Polo", true), card("Casaca")] })).toBe("1 unidad");
    expect(badge({ kind: "products", cards: [card("Polo", true), card("Casaca", true)] })).toBe("0 unidades");
    expect(badge({ kind: "samples" })).toBe("1 unidad");
    expect(badge({ kind: "loading" })).toBe("0 unidades");
  });

  test("the catalog preview is inert and hidden from screen readers", () => {
    const view = html({ kind: "samples" });
    expect(view).toMatch(/^<div aria-hidden="true" inert="" data-slot="catalog-preview"/);
    expect(view).not.toContain("<a ");
    expect(view).toContain('tabindex="-1"');
    expect(view).toContain("readOnly");
  });
});
