import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CatalogShell } from "@core/app/components/catalog-sections";

describe("CatalogShell", () => {
  test("paints the public catalog with the global Yoyos tokens and the company logo", () => {
    const html = renderToStaticMarkup(<CatalogShell logoUrl="https://cdn.example/logo.png" storeName="Lima Studio"><p>Productos</p></CatalogShell>);
    expect(html).toContain("bg-background");
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).toContain("Lima Studio");
    // No theme scope, no variables: the page reads the global tokens.
    expect(html).not.toContain("<style");
    expect(html).not.toContain("data-store-theme");
  });

  test("shows only the store name when the company has no logo", () => {
    const html = renderToStaticMarkup(<CatalogShell logoUrl={null} storeName="Lima Studio"><p>Productos</p></CatalogShell>);
    expect(html).not.toContain("<img");
    expect(html).toContain("Lima Studio");
  });
});
