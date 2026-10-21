import { describe, expect, test } from "vitest";
import { checkoutThemeIds, checkoutThemes, type CheckoutThemeDefinition } from "@core/src/features/checkout-appearance/domain/checkout-themes";
import { checkoutFontStacks, checkoutThemeCss } from "@core/src/features/checkout-appearance/presentation/checkout-theme-style";

const scope = ":r1:";
const scopeSelector = `[data-checkout-theme="${scope}"]`;

/** Values that identify a theme: its colors, self-hosted font family and page gradient (short style values like "4px" collide as substrings). */
function identifyingValues(theme: CheckoutThemeDefinition): Set<string> {
  return new Set([
    ...Object.values(theme.colors), ...(theme.backgroundImage ? [theme.backgroundImage.css] : []),
    ...Object.values(theme.fonts).filter((family) => family !== "system").map((family) => /^"[^"]+"/.exec(checkoutFontStacks[family])?.[0] ?? ""),
  ]);
}

/** Every value a theme may write: colors, style, fonts, logo, thumbnail and the page background. */
function catalogValues(theme: CheckoutThemeDefinition): Set<string> {
  return new Set([
    ...Object.values(theme.colors), ...Object.values(theme.style), ...Object.values(theme.logo), ...Object.values(theme.thumbnail),
    ...Object.values(theme.fonts).map((family) => checkoutFontStacks[family]), ...(theme.backgroundImage ? [theme.backgroundImage.css] : []),
  ]);
}
const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1], body: match[2] }));
const declarations = (body: string) => body.split(";").filter(Boolean).map((declaration) => {
  const colon = declaration.indexOf(":");
  return { name: declaration.slice(0, colon), value: declaration.slice(colon + 1) };
});

describe("checkoutThemeCss", () => {
  test("scopes every value of the chosen theme to the checkout subtree", () => {
    for (const id of checkoutThemeIds) {
      const css = checkoutThemeCss(id, scope);
      const selectors = rules(css).map((rule) => rule.selector);
      expect(selectors, id).toEqual([scopeSelector, `html:has(${scopeSelector})`]);
      expect(css, id).not.toContain(":root");
      const { colors } = checkoutThemes[id];
      expect(css, id).toContain(`--background:${colors.background};`);
      expect(css, id).toContain(`--primary:${colors.primary};`);
      expect(css, id).toContain(`--card-foreground:${colors["card-foreground"]};`);
      expect(css, id).toContain(`--checkout-text-body:${checkoutThemes[id].style["text-body"]};`);
    }
  });

  test("writes no value of another theme", () => {
    for (const id of checkoutThemeIds) {
      const own = identifyingValues(checkoutThemes[id]);
      const css = checkoutThemeCss(id, scope);
      for (const other of checkoutThemeIds.filter((candidate) => candidate !== id))
        for (const value of identifyingValues(checkoutThemes[other])) if (!own.has(value)) expect(css, `${id} must not carry ${value} of ${other}`).not.toContain(value);
    }
  });

  test("writes only catalog values in the style", () => {
    for (const id of checkoutThemeIds) {
      const theme = checkoutThemes[id];
      const allowed = catalogValues(theme);
      const [scoped] = rules(checkoutThemeCss(id, scope));
      for (const { name, value } of declarations(scoped.body)) {
        if (name.startsWith("--")) expect(allowed.has(value) || /^(row|column|left|center)$/.test(value), `${id} ${name}: ${value}`).toBe(true);
        else expect(["color-scheme", "color", "background-color", "background-image", "font-family", "font-size", "font-weight", "line-height"], `${id} ${name}`).toContain(name);
      }
    }
  });

  test("paints the page background behind the checkout", () => {
    for (const id of checkoutThemeIds)
      expect(checkoutThemeCss(id, scope), id).toContain(`html:has(${scopeSelector}){background:${checkoutThemes[id].colors.background};}`);
    expect(checkoutThemeCss("suave", scope)).toContain(`background-image:${checkoutThemes.suave.backgroundImage?.css}`);
    expect(checkoutThemeCss("classic", scope)).not.toContain("background-image");
  });

  test("declares the fixed color scheme of the theme", () => {
    expect(checkoutThemeCss("noche", scope)).toContain("color-scheme:dark");
    expect(checkoutThemeCss("boutique", scope)).toContain("color-scheme:light");
  });
});

describe("checkoutFontStacks", () => {
  test("falls back to system fonts after each self-hosted family", () => {
    expect(checkoutFontStacks.system).toContain("-apple-system");
    expect(checkoutFontStacks["playfair-display"]).toMatch(/^"Playfair Display Variable",.*serif$/);
    expect(checkoutFontStacks.fredoka).toMatch(/^"Fredoka Variable"/);
    expect(checkoutFontStacks.nunito).toMatch(/^"Nunito Variable"/);
    expect(checkoutFontStacks.outfit).toMatch(/^"Outfit Variable"/);
    expect(checkoutFontStacks.inter).toMatch(/^"Inter Variable"/);
  });
});
