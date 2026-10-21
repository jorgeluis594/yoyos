// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { checkoutThemeIds, checkoutThemes } from "@core/src/features/checkout-appearance/domain/checkout-themes";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";

const styleOf = (html: string) => /<style>(.*?)<\/style>/s.exec(html)?.[1] ?? "";
const scopeOf = (html: string) => /<div data-checkout-theme="([^"]+)"/.exec(html)?.[1];
const render = (theme: Parameters<typeof CheckoutTheme>[0]["appearance"]) => renderToStaticMarkup(<CheckoutTheme appearance={theme}><p>Pedido</p></CheckoutTheme>);

describe("CheckoutTheme", () => {
  test("renders Clásico when the company has no appearance", () => {
    const html = render(null);
    expect(html).toContain('data-checkout-theme-id="classic"');
    expect(styleOf(html)).toContain(`--background:${checkoutThemes.classic.colors.background};`);
    expect(html).toContain("Pedido");
  });

  test("renders Noche dark even when the page prefers light", () => {
    const html = render({ theme: "noche" });
    expect(html).toMatch(/<div data-checkout-theme="[^"]+" data-checkout-theme-id="noche" class="dark /);
    expect(styleOf(html)).toContain("color-scheme:dark;");
    expect(styleOf(html)).toContain(`--background:${checkoutThemes.noche.colors.background};`);
  });

  test("renders a light theme light even inside a dark page", () => {
    const html = renderToStaticMarkup(<div className="dark"><CheckoutTheme appearance={{ theme: "boutique" }}><p /></CheckoutTheme></div>);
    expect(html).not.toMatch(/data-checkout-theme-id="boutique" class="[^"]*dark/);
    expect(styleOf(html)).toContain("color-scheme:light;");
    expect(styleOf(html)).toContain(`--background:${checkoutThemes.boutique.colors.background};`);
  });

  test("keeps each theme inside its own checkout", () => {
    const html = renderToStaticMarkup(<>
      <CheckoutTheme appearance={{ theme: "boutique" }}><p /></CheckoutTheme>
      <CheckoutTheme appearance={{ theme: "noche" }}><p /></CheckoutTheme>
    </>);
    const styles = [...html.matchAll(/<style>(.*?)<\/style>/gs)].map((match) => match[1]);
    const scopes = [...html.matchAll(/<div data-checkout-theme="([^"]+)"/g)].map((match) => match[1]);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(styles).toHaveLength(2);
    scopes.forEach((scope, index) => {
      expect([...styles[index].matchAll(/\[data-checkout-theme="([^"]+)"\]/g)].map((match) => match[1])).toEqual([scope, scope]);
    });
    expect(styles[0]).toContain(`--background:${checkoutThemes.boutique.colors.background};`);
    expect(styles[1]).toContain(`--background:${checkoutThemes.noche.colors.background};`);
  });

  test("scopes the chosen theme and paints the page behind it", () => {
    for (const theme of checkoutThemeIds) {
      const html = render({ theme });
      const scope = scopeOf(html);
      expect(styleOf(html)).toContain(`html:has([data-checkout-theme="${scope}"])`);
      expect(styleOf(html)).not.toContain(":root");
    }
  });
});
