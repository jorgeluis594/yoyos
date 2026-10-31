import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import type { CatalogCard } from "@core/src/features/products/domain/catalog-product";
import type { ProductId } from "@core/src/features/products/domain/product";
import { CatalogProductCard, CatalogShell, StoreNotFound } from "@core/app/components/catalog-sections";

const clasico = { logoUrl: null, theme: "classic" } as const;

describe("CatalogShell", () => {
  test("paints the public catalog in the store theme with the company logo", () => {
    const html = renderToStaticMarkup(<MemoryRouter><CatalogShell appearance={{ logoUrl: "https://cdn.example/logo.png", theme: "boutique" }} storeName="Lima Studio"><p>Productos</p></CatalogShell></MemoryRouter>);
    expect(html).toContain('data-store-theme-id="boutique"');
    expect(html).toContain("<style>");
    expect(html).toContain('data-store-part="header"');
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).toContain("Lima Studio");
  });

  test("links the store logo and name to the catalog home, unless the shell is inert", () => {
    const shell = (linkHome?: boolean) => renderToStaticMarkup(<MemoryRouter><CatalogShell appearance={{ logoUrl: "https://cdn.example/logo.png", theme: "classic" }} storeName="Lima Studio" linkHome={linkHome}><p>Productos</p></CatalogShell></MemoryRouter>);
    expect(shell()).toMatch(/<a data-store-part="header-brand" data-slot="brand-link"[^>]*href="\/"[^>]*>.*Lima Studio/);
    expect(shell(false)).not.toContain("<a ");
  });

  test("renders Noche dark inside the shell", () => {
    const html = renderToStaticMarkup(<MemoryRouter><CatalogShell appearance={{ logoUrl: null, theme: "noche" }} storeName="Lima Studio"><p>Productos</p></CatalogShell></MemoryRouter>);
    expect(html).toMatch(/data-store-theme-id="noche" class="dark /);
  });

  test("shows only the store name when the company has no logo", () => {
    const html = renderToStaticMarkup(<MemoryRouter><CatalogShell appearance={clasico} storeName="Lima Studio"><p>Productos</p></CatalogShell></MemoryRouter>);
    expect(html).not.toContain("<img");
    expect(html).toContain("Lima Studio");
  });
});

describe("CatalogProductCard", () => {
  const item: CatalogCard = { id: "00000000-0000-4000-8000-000000000001" as ProductId, name: "Casaca negra", imageUrl: null, price: { kind: "single", amount: { amount: 45, currency: "PEN" } }, soldOut: true };

  test("links to the product with the sold-out badge, or stays inert without a link", () => {
    const linked = renderToStaticMarkup(<MemoryRouter><CatalogProductCard item={item} to="productos/1" /></MemoryRouter>);
    expect(linked).toMatch(/^<a data-store-part="catalog-card"[^>]*href="\/productos\/1"/);
    expect(linked).toContain('data-store-part="catalog-sold-out"');
    expect(linked).toContain("Agotado");
    const inert = renderToStaticMarkup(<CatalogProductCard item={item} />);
    expect(inert).not.toContain("<a ");
    expect(inert).not.toContain("/catalogo/");
    expect(inert).toContain('<div data-store-part="catalog-card"');
  });
});

test("the catalog card keeps the neutral block with the initial when a product has no photos", () => {
  const card: CatalogCard = { id: "00000000-0000-4000-8000-000000000002" as ProductId, name: "Casaca negra", imageUrl: null, price: { kind: "single", amount: { amount: 45, currency: "PEN" } }, soldOut: false };
  const html = renderToStaticMarkup(<CatalogProductCard item={card} />);
  expect(html).not.toContain("<img");
  expect(html).toMatch(/data-store-part="catalog-card-photo"[^>]*>C</);
});

describe("StoreNotFound", () => {
  test("shows the store's own «No encontramos esta página» with its name, a way back to /, and no index", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StoreNotFound storeName="Fantasio" appearance={{ logoUrl: "https://cdn.example/logo.png", theme: "boutique" }} /></MemoryRouter>);
    expect(html).toContain('data-store-theme-id="boutique"');
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).toContain("Fantasio");
    expect(html).toContain("No encontramos esta página");
    expect(html).toContain("Revisa el link o mira los productos de la tienda.");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Volver al catálogo<\/a>/);
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).not.toContain("Página no encontrada");
  });
});
