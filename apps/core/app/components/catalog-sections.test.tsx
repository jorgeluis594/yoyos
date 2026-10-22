import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import type { CatalogCard } from "@core/src/features/products/domain/catalog-product";
import type { ProductId } from "@core/src/features/products/domain/product";
import { CatalogProductCard, CatalogShell } from "@core/app/components/catalog-sections";

const clasico = { logoUrl: null, theme: "classic" } as const;

describe("CatalogShell", () => {
  test("paints the public catalog in the store theme with the company logo", () => {
    const html = renderToStaticMarkup(<CatalogShell appearance={{ logoUrl: "https://cdn.example/logo.png", theme: "boutique" }} storeName="Lima Studio"><p>Productos</p></CatalogShell>);
    expect(html).toContain('data-store-theme-id="boutique"');
    expect(html).toContain("<style>");
    expect(html).toContain('data-store-part="header"');
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).toContain("Lima Studio");
  });

  test("renders Noche dark inside the shell", () => {
    const html = renderToStaticMarkup(<CatalogShell appearance={{ logoUrl: null, theme: "noche" }} storeName="Lima Studio"><p>Productos</p></CatalogShell>);
    expect(html).toMatch(/data-store-theme-id="noche" class="dark /);
  });

  test("shows only the store name when the company has no logo", () => {
    const html = renderToStaticMarkup(<CatalogShell appearance={clasico} storeName="Lima Studio"><p>Productos</p></CatalogShell>);
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
    expect(inert).toContain('<div data-store-part="catalog-card"');
  });
});
