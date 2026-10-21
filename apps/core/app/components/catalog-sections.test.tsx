import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CatalogShell } from "@core/app/components/catalog-sections";

describe("CatalogShell", () => {
  test("paints the public catalog with the former white background and the global borders", () => {
    const html = renderToStaticMarkup(
      <CatalogShell appearance={{ logoUrl: null, brandColor: "forest", background: "soft" }} storeName="Lima Studio"><p>Productos</p></CatalogShell>);
    const css = /<style>(.*?)<\/style>/s.exec(html)?.[1] ?? "";
    expect(css).toContain("--background:#FFFFFF");
    expect(css).toContain("--primary:#2F6B4F");
    for (const token of ["border", "input", "card", "muted", "foreground"]) expect(css).not.toMatch(new RegExp(`--${token}:`));
    expect(css).not.toMatch(/#DCD4C9|#484249/);
  });
});
