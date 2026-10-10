// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import { checkoutBrandColors } from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { checkoutBrandColorCatalog } from "@core/src/features/checkout-appearance/domain/checkout-colors";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const appearance = { logoUrl: null, brandColor: "forest", background: "brand_tint" } as const;
const styleOf = (html: string) => /<style>(.*?)<\/style>/s.exec(html)?.[1] ?? "";

describe("CheckoutTheme", () => {
  test("renders no styles when the company has no appearance", () => {
    const html = renderToStaticMarkup(<CheckoutTheme appearance={null}><p>Pedido</p></CheckoutTheme>);
    expect(html).not.toContain("<style");
    expect(html).toContain("Pedido");
  });

  test("scopes light and dark variables to the checkout", () => {
    const css = styleOf(renderToStaticMarkup(<CheckoutTheme appearance={appearance}><p>Pedido</p></CheckoutTheme>));
    const { light, dark } = checkoutBrandColorCatalog.forest;
    expect(css).toMatch(/^\[data-checkout-theme\]\{[^}]*--primary:#2F6B4F;[^}]*--background:#F1F6F2;[^}]*\}\.dark \[data-checkout-theme\]\{[^}]*--primary:#8FCBA8;[^}]*--background:#181E1B;[^}]*\}$/);
    expect(css).toContain(`--primary-foreground:${light["primary-foreground"]}`);
    expect(css).toContain(`--accent:${dark.accent}`);
    expect(css).not.toContain(":root");
  });

  test("renders only catalog colors in the style tag", () => {
    const catalogHex = new Set(checkoutBrandColors.flatMap((color) => [checkoutBrandColorCatalog[color].light, checkoutBrandColorCatalog[color].dark].flatMap((tokens) => Object.values(tokens))));
    const allowed = new Set([...catalogHex, "#FFFFFF", "#F7F4EF", "#1C1B1D"]);
    for (const color of checkoutBrandColors) {
      const css = styleOf(renderToStaticMarkup(<CheckoutTheme appearance={{ ...appearance, brandColor: color }}><p /></CheckoutTheme>));
      const colors = css.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
      expect(colors.length).toBeGreaterThan(0);
      for (const value of colors) expect(allowed.has(value)).toBe(true);
    }
  });
});

describe("CheckoutBrandHeader", () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

  function mount(logoUrl: string | null) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<CheckoutBrandHeader companyName="Lima Studio" logoUrl={logoUrl} />));
    return container;
  }

  test("shows the logo next to the company name", () => {
    const container = mount("https://cdn.example/logo.png");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/logo.png");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(container.textContent).toBe("Lima Studio");
  });

  test("shows only the company name when there is no logo", () => {
    const container = mount(null);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("Lima Studio");
  });

  test("hides the logo and keeps the name when the image fails to load", () => {
    const container = mount("https://cdn.example/broken.png");
    act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-slot="brand-logo"]')).toBeNull();
    expect(container.textContent).toBe("Lima Studio");
  });
});
