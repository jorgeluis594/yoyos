import { describe, expect, test } from "vitest";
import {
  appliedFiltersLine, catalogLine, combinationOf, emptySearchMessage, moreProductsLine, stockLine, toAssistantProduct, toAssistantProductSummary, vocabularyMessage,
  type ProjectableActive, type ProjectableProduct, type ProjectableProductSummary, type ProjectableStorefront, type ProjectableVariantLine,
} from "@core/src/features/assistants/domain/product-projection";
import { display } from "@core/src/features/assistants/presentation/display";

const context = { display, appLink: (id: string) => `https://app.yoyos.lat/products/${id}` };
const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const published: ProjectableStorefront = { currency: "PEN", catalog: { kind: "published", storeLink: "https://rosa.yoyos.lat/" } };
const id = "00000000-0000-4000-8000-000000000001";

const some = (overrides: Partial<Extract<ProjectableActive, { kind: "some" }>> = {}): ProjectableActive => ({
  kind: "some", minSalePrice: pen(39.9), hasDifferentPrices: true, totalStock: 12, soldOut: 1, low: 1, onlyLevel: null, sku: { kind: "several" }, ...overrides,
});
const none: ProjectableActive = { kind: "none", sku: { kind: "single", sku: null } };
const line = (overrides: Partial<ProjectableVariantLine> = {}): ProjectableVariantLine => ({ values: ["M", "Azul"], sku: "POL-M-AZ", salePrice: pen(39.9), stock: 2, level: "low", ...overrides });
const summary = (overrides: Partial<ProjectableProductSummary> = {}): ProjectableProductSummary => ({
  id, name: "Polo básico", variantCount: 6, inactiveCount: 1, active: some(), customerLink: "https://rosa.yoyos.lat/productos/x", matching: null, ...overrides,
});
const product = (overrides: Partial<ProjectableProduct> = {}): ProjectableProduct => ({
  id, name: "Polo básico", description: "Algodón pima", options: [{ name: "Talla", values: ["M", "L"] }, { name: "Color", values: ["Azul", "Rojo"] }], active: some(),
  customerLink: null, variants: [{ ...line(), purchasePrice: pen(20), isActive: true, searched: false }], ...overrides,
});

describe("stock line", () => {
  test("summarizes S = 0, M = 2, L = 10 as «Stock: 12 · 1 agotada, 1 con stock bajo»", () => {
    expect(stockLine(some({ totalStock: 12, soldOut: 1, low: 1 }))).toBe("Stock: 12 · 1 agotada, 1 con stock bajo");
  });

  test("summarizes six sizes at 1 unit as «Stock: 6 · 6 con stock bajo»", () => {
    expect(stockLine(some({ totalStock: 6, soldOut: 0, low: 6 }))).toBe("Stock: 6 · 6 con stock bajo");
  });

  test("shows «Stock: 0 · Agotado» only when every active variant is at 0", () => {
    expect(stockLine(some({ totalStock: 0, soldOut: 2, low: 0 }))).toBe("Stock: 0 · Agotado");
    expect(stockLine(some({ totalStock: 2, soldOut: 1, low: 1 }))).not.toContain("Stock: 2 · Agotado");
    expect(stockLine(some({ totalStock: 10, soldOut: 2, low: 0 }))).toBe("Stock: 10 · 2 agotadas");
  });

  test("shows «Stock bajo» for a product without options with 2 units", () => {
    expect(stockLine(some({ totalStock: 2, soldOut: 0, low: 1, onlyLevel: "low" }))).toBe("Stock: 2 · Stock bajo");
    expect(stockLine(some({ totalStock: 10, soldOut: 0, low: 0, onlyLevel: "available" }))).toBe("Stock: 10");
  });
});

describe("search item", () => {
  test("gives a product without active variants no price, no stock line, no level and no customer link", () => {
    const item = toAssistantProductSummary(summary({ active: none, customerLink: null, inactiveCount: 2, variantCount: 2 }), context);
    expect(item).toMatchObject({ precio: "Sin variantes activas", en_catalogo: "No está en el catálogo: sin variantes activas", sku: "Sin SKU", variantes: "2 variantes, 2 desactivadas" });
    expect(item).not.toHaveProperty("stock");
    expect(item).not.toHaveProperty("enlace_cliente");
    expect(JSON.stringify(item)).not.toContain("Agotado");
  });

  test("never includes a purchase price in a search item", () => {
    const item = toAssistantProductSummary(summary({ matching: { variants: [line()], total: 1 } }), context);
    expect(JSON.stringify(item)).not.toMatch(/compra/i);
    expect(item.variantes_coincidentes).toEqual([{ combinacion: "M / Azul", sku: "POL-M-AZ", precio: "S/ 39.90", stock: 2, nivel: "Stock bajo" }]);
  });

  test("writes the price, SKU, variant count, links and in-catalog line", () => {
    expect(toAssistantProductSummary(summary(), context)).toEqual({
      id, nombre: "Polo básico", sku: "Varias variantes", precio: "Desde S/ 39.90", stock: "Stock: 12 · 1 agotada, 1 con stock bajo", en_catalogo: "En el catálogo",
      variantes: "6 variantes, 1 desactivada", enlace: `https://app.yoyos.lat/products/${id}`, enlace_cliente: "https://rosa.yoyos.lat/productos/x",
    });
    expect(toAssistantProductSummary(summary({ active: some({ hasDifferentPrices: false, sku: { kind: "single", sku: "POL-1" } }), variantCount: 1, inactiveCount: 0 }), context))
      .toMatchObject({ precio: "S/ 39.90", sku: "POL-1", variantes: "1 variante" });
  });

  test("lists 10 matching variants and «y 4 variantes más: usa Ver producto»", () => {
    const item = toAssistantProductSummary(summary({ matching: { variants: Array.from({ length: 10 }, () => line()), total: 14 } }), context);
    expect(item.variantes_coincidentes).toHaveLength(10);
    expect(item.mas_variantes).toBe("y 4 variantes más: usa Ver producto");
    expect(toAssistantProductSummary(summary({ matching: { variants: [line()], total: 1 } }), context)).not.toHaveProperty("mas_variantes");
  });

  test("shortens names to 100 characters, combinations to 50 and search SKUs to 40, and leaves the level out above the threshold", () => {
    const item = toAssistantProductSummary(summary({ name: "N".repeat(150), matching: { variants: [line({ values: ["C".repeat(60)], sku: "S".repeat(60), level: "available" })], total: 1 } }), context);
    expect(item.nombre).toHaveLength(100);
    expect(item.nombre.endsWith("…")).toBe(true);
    expect(item.variantes_coincidentes?.[0]).toMatchObject({ combinacion: `${"C".repeat(49)}…`, sku: `${"S".repeat(39)}…` });
    expect(item.variantes_coincidentes?.[0]).not.toHaveProperty("nivel");
    expect(combinationOf([])).toBe("Sin opciones");
  });
});

describe("pages", () => {
  test("adds «hay más: pide la página 2» on page 1 of 45 and no more line on page 3", () => {
    expect(moreProductsLine(1, 45)).toBe("hay más: pide la página 2");
    expect(moreProductsLine(2, 45)).toBe("hay más: pide la página 3");
    expect(moreProductsLine(3, 45)).toBeUndefined();
    expect(moreProductsLine(1, 20)).toBeUndefined();
  });
});

describe("product detail", () => {
  test("cuts a 1,500-character description at 1,000 with «… (la descripción continúa en Yoyos)»", () => {
    const answer = toAssistantProduct(product({ description: "d".repeat(1500) }), published, context);
    expect(answer.descripcion).toBe(`${"d".repeat(1000)}… (la descripción continúa en Yoyos)`);
    expect(toAssistantProduct(product({ description: "d".repeat(1000) }), published, context).descripcion).toBe("d".repeat(1000));
    expect(toAssistantProduct(product({ description: null }), published, context)).not.toHaveProperty("descripcion");
  });

  test("shows «Sin precio de compra» when it was never entered and «S/ 0.00» when it was entered as 0", () => {
    const answer = toAssistantProduct(product({ variants: [
      { ...line(), purchasePrice: null, isActive: true, searched: false }, { ...line({ values: ["L", "Rojo"] }), purchasePrice: pen(0), isActive: true, searched: false },
    ] }), published, context);
    expect(answer.variantes.map((variant) => variant.precio_compra)).toEqual(["Sin precio de compra", "S/ 0.00"]);
  });

  test("marks deactivated variants without a level and the variant found by SKU", () => {
    const answer = toAssistantProduct(product({ variants: [
      { ...line(), purchasePrice: pen(20), isActive: true, searched: true }, { ...line({ values: ["L", "Rojo"], stock: 0, level: "sold_out" }), purchasePrice: null, isActive: false, searched: false },
    ] }), published, context);
    expect(answer.variantes[0]).toMatchObject({ estado: "Activa", buscada_por_sku: true, nivel: "Stock bajo", stock: 2 });
    expect(answer.variantes[1]).toMatchObject({ estado: "Desactivada", stock: 0 });
    expect(answer.variantes[1]).not.toHaveProperty("nivel");
    expect(answer.variantes[1]).not.toHaveProperty("buscada_por_sku");
    expect(answer.opciones).toEqual([{ nombre: "Talla", valores: ["M", "L"] }, { nombre: "Color", valores: ["Azul", "Rojo"] }]);
    expect(answer.catalogo).toBe("Tu catálogo está publicado en https://rosa.yoyos.lat/.");
  });

  test("shows SKUs whole in the detail", () => {
    const answer = toAssistantProduct(product({ variants: [{ ...line({ sku: "S".repeat(100) }), purchasePrice: null, isActive: true, searched: false }] }), published, context);
    expect(answer.variantes[0]?.sku).toBe("S".repeat(100));
  });
});

describe("value rejections", () => {
  const vocabulary = [{ name: "Color", values: ["Azul", "Azul claro", "Negro", "Rojo"] }, { name: "Talla", values: ["S", "M", "L"] }];

  test('answers «Tu tienda no tiene el valor "Celeste". Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.»', () => {
    expect(vocabularyMessage({ kind: "unknown_value", written: "Celeste", vocabulary }))
      .toBe('Tu tienda no tiene el valor "Celeste". Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.');
  });

  test('answers «Tu tienda no tiene el valor "M" en Color.» with the store\'s values', () => {
    expect(vocabularyMessage({ kind: "value_in_other_option", written: "M", option: "Color", vocabulary }))
      .toBe('Tu tienda no tiene el valor "M" en Color. Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.');
  });

  test("answers the unknown-option text for «Material: Algodón» with the store's values", () => {
    expect(vocabularyMessage({ kind: "unknown_option", option: "Material", vocabulary }))
      .toBe('Tu tienda no tiene la opción "Material". Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.');
  });

  test("answers «Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto.» in a store without options", () => {
    expect(vocabularyMessage({ kind: "no_options" })).toBe("Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto.");
  });

  test("cuts the value list at 100 with «y 30 valores más»", () => {
    const wide = [{ name: "Color", values: Array.from({ length: 60 }, (_, index) => `c${index}`) }, { name: "Talla", values: Array.from({ length: 70 }, (_, index) => `t${index}`) }];
    const message = vocabularyMessage({ kind: "unknown_value", written: "x", vocabulary: wide });
    expect(message).toContain("t39 y 30 valores más.");
    expect(message).not.toContain("t40");
    const onlyColors = vocabularyMessage({ kind: "unknown_value", written: "x", vocabulary: [{ name: "Color", values: Array.from({ length: 100 }, (_, index) => `c${index}`) }, { name: "Talla", values: ["S"] }] });
    expect(onlyColors).toContain("c99 y 1 valor más.");
    expect(onlyColors).not.toContain("Talla");
  });
});

describe("catalog line and empty answers", () => {
  test("writes the published, hidden and never-linked catalog sentences", () => {
    expect(catalogLine(published)).toBe("Tu catálogo está publicado en https://rosa.yoyos.lat/.");
    expect(catalogLine({ currency: "PEN", catalog: { kind: "hidden" } })).toBe("Tu catálogo está oculto: ahora nadie ve tus productos.");
    expect(catalogLine({ currency: "PEN", catalog: { kind: "hidden_without_link" } })).toBe("Tu catálogo está oculto y no tiene link todavía.");
  });

  test("answers «No hay productos con esos filtros: precio hasta S/ 30.00.» with the catalog line", () => {
    expect(emptySearchMessage({ priceToCents: 3000 }, "PEN", true, display)).toBe("No hay productos con esos filtros: precio hasta S/ 30.00.");
    expect(catalogLine(published)).toContain("rosa.yoyos.lat");
  });

  test("writes every applied filter in an empty answer", () => {
    expect(appliedFiltersLine({ text: "polos", values: ["Azul", "Color: M"], priceFromCents: 4000, priceToCents: 13000, stock: "low", inCatalog: true }, "PEN", display))
      .toBe('texto "polos", valores "Azul", "Color: M", precio desde S/ 40.00, precio hasta S/ 130.00, stock bajo, en el catálogo');
    expect(appliedFiltersLine({ stock: "in_stock", inCatalog: false }, "PEN", display)).toBe("con stock, fuera del catálogo");
    expect(appliedFiltersLine({ stock: "sold_out" }, "PEN", display)).toBe("agotado");
  });

  test("answers «Tu tienda todavía no tiene productos.» for a store without products and a generic line when no filter was applied", () => {
    expect(emptySearchMessage({ text: "polo" }, "PEN", false, display)).toBe("Tu tienda todavía no tiene productos.");
    expect(emptySearchMessage({}, "PEN", true, display)).toBe("No hay productos con esos filtros.");
  });
});
