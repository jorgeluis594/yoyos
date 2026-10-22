import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { storeThemeIds, storeThemes, type StoreThemeDefinition } from "@shared/store-themes";
import { storeFontStacks, storeThemeCss } from "@core/src/features/store-appearance/presentation/store-theme-style";

const scope = ":r1:";
const scopeSelector = `[data-store-theme="${scope}"]`;

/** Values that identify a theme: its colors, self-hosted font family and page gradient (short style values like "4px" collide as substrings). */
function identifyingValues(theme: StoreThemeDefinition): Set<string> {
  return new Set([
    ...Object.values(theme.colors), ...(theme.backgroundImage ? [theme.backgroundImage.css] : []),
    ...Object.values(theme.fonts).filter((family) => family !== "system").map((family) => /^"[^"]+"/.exec(storeFontStacks[family])?.[0] ?? ""),
  ]);
}

/** Every value a theme may write: colors, style, fonts, logo, thumbnail and the page background. */
function catalogValues(theme: StoreThemeDefinition): Set<string> {
  return new Set([
    ...Object.values(theme.colors), ...Object.values(theme.style), ...Object.values(theme.logo), ...Object.values(theme.thumbnail),
    ...Object.values(theme.fonts).map((family) => storeFontStacks[family]), ...(theme.backgroundImage ? [theme.backgroundImage.css] : []),
  ]);
}
const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1], body: match[2] }));
const declarations = (body: string) => body.split(";").filter(Boolean).map((declaration) => {
  const colon = declaration.indexOf(":");
  return { name: declaration.slice(0, colon), value: declaration.slice(colon + 1) };
});

describe("storeThemeCss", () => {
  test("scopes every value of the chosen theme to the checkout subtree", () => {
    for (const id of storeThemeIds) {
      const css = storeThemeCss(id, scope);
      const selectors = rules(css).map((rule) => rule.selector);
      expect(selectors, id).toEqual([scopeSelector, `html:has(${scopeSelector})`]);
      expect(css, id).not.toContain(":root");
      const { colors } = storeThemes[id];
      expect(css, id).toContain(`--background:${colors.background};`);
      expect(css, id).toContain(`--primary:${colors.primary};`);
      expect(css, id).toContain(`--card-foreground:${colors["card-foreground"]};`);
      expect(css, id).toContain(`--store-text-body:${storeThemes[id].style["text-body"]};`);
    }
  });

  test("writes no value of another theme", () => {
    for (const id of storeThemeIds) {
      const own = identifyingValues(storeThemes[id]);
      const css = storeThemeCss(id, scope);
      for (const other of storeThemeIds.filter((candidate) => candidate !== id))
        for (const value of identifyingValues(storeThemes[other])) if (!own.has(value)) expect(css, `${id} must not carry ${value} of ${other}`).not.toContain(value);
    }
  });

  test("writes only catalog values in the style", () => {
    for (const id of storeThemeIds) {
      const theme = storeThemes[id];
      const allowed = catalogValues(theme);
      const [scoped] = rules(storeThemeCss(id, scope));
      for (const { name, value } of declarations(scoped.body)) {
        if (name.startsWith("--")) expect(allowed.has(value) || /^(row|column|left|center)$/.test(value), `${id} ${name}: ${value}`).toBe(true);
        else expect(["color-scheme", "color", "background-color", "background-image", "font-family", "font-size", "font-weight", "line-height"], `${id} ${name}`).toContain(name);
      }
    }
  });

  test("paints the page background behind the checkout", () => {
    for (const id of storeThemeIds)
      expect(storeThemeCss(id, scope), id).toContain(`html:has(${scopeSelector}){background:${storeThemes[id].colors.background};}`);
    expect(storeThemeCss("suave", scope)).toContain(`background-image:${storeThemes.suave.backgroundImage?.css}`);
    expect(storeThemeCss("classic", scope)).not.toContain("background-image");
  });

  test("declares the fixed color scheme of the theme", () => {
    expect(storeThemeCss("noche", scope)).toContain("color-scheme:dark");
    expect(storeThemeCss("boutique", scope)).toContain("color-scheme:light");
  });
});

describe("storeFontStacks", () => {
  test("falls back to system fonts after each self-hosted family", () => {
    expect(storeFontStacks.system).toContain("-apple-system");
    expect(storeFontStacks["playfair-display"]).toMatch(/^"Playfair Display Variable",.*serif$/);
    expect(storeFontStacks.fredoka).toMatch(/^"Fredoka Variable"/);
    expect(storeFontStacks.nunito).toMatch(/^"Nunito Variable"/);
    expect(storeFontStacks.outfit).toMatch(/^"Outfit Variable"/);
    expect(storeFontStacks.inter).toMatch(/^"Inter Variable"/);
  });
});

describe("store-theme.css", () => {
  const stylesheet = readFileSync(new URL("./store-theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...stylesheet.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim());

  test("styles only parts inside a themed checkout", () => {
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) expect(selector, selector).toMatch(/^\[data-store-theme\] /);
  });

  test("reads only variables that every theme writes", () => {
    const [scoped] = rules(storeThemeCss("classic", scope));
    const written = new Set(declarations(scoped.body).map((declaration) => declaration.name));
    const read = [...stylesheet.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    expect(read.length).toBeGreaterThan(50);
    for (const name of read) expect(written.has(name), name).toBe(true);
  });

  test("declares keyboard focus and invalid fields with the theme's ring and destructive tokens", () => {
    const focus = [...stylesheet.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^{}]*)\}/g)];
    expect(focus.length).toBeGreaterThan(1);
    // A native radio draws no ring of its own: its option or payment chip draws the one ring.
    const nativeRadio = (selector: string) => selector.includes('input[data-slot="radio-group-item"]');
    for (const [, selector, body] of focus) expect(body, selector).toMatch(nativeRadio(selector) ? /outline:\s*none/ : /outline:\s*2px solid var\(--ring\)/);
    expect(focus.map(([, selector]) => selector).join(" ")).toMatch(/data-slot="button"[\s\S]*data-slot="input"/);
    const invalid = [...stylesheet.matchAll(/([^{}]*\[aria-invalid="true"\][^{}]*)\{([^{}]*)\}/g)];
    expect(invalid.length).toBe(1);
    expect(invalid[0][2]).toContain("border-color: var(--destructive)");
    expect(invalid[0][2]).toContain("var(--destructive)");
  });

  test("gives a checked payment method and a checked option the selected look and a readable text color", () => {
    const selectedBorder = { "payment-method": "var(--selected)", option: "var(--store-selected-border)" };
    for (const part of ["payment-method", "option"] as const) {
      const checked = [...stylesheet.matchAll(new RegExp(`data-store-part="${part}"\\]:is\\([^{}]*\\{([^{}]*)\\}`, "g"))].map((match) => match[1]).join("");
      for (const property of [`border-color: ${selectedBorder[part]}`, "background-color: var(--selected-surface)", "color: var(--foreground)"]) expect(checked, `${part} ${property}`).toContain(property);
    }
  });

  test("paints payment chips with their own border, outline and shadow tokens, and the option group with the selected border token", () => {
    const chips = stylesheet.match(/data-store-part="payment-method"\] \{([^{}]*)\}/)?.[1] ?? "";
    expect(chips).toContain("border: var(--store-payment-border)");
    const checked = [...stylesheet.matchAll(/data-store-part="payment-method"\]:is\([^{}]*\{([^{}]*)\}/g)].map((match) => match[1]).join("");
    expect(checked).toContain("outline: var(--store-payment-selected-outline)");
    expect(checked).toContain("box-shadow: var(--store-payment-selected-shadow)");
  });

  test("keeps the checked state of Boutique and Noche free of a selected border, and Noche chips free of a selected shadow", () => {
    for (const id of ["boutique", "noche"] as const) expect(storeThemes[id].style["selected-border"], id).toBe("transparent");
    expect(storeThemes.boutique.style["payment-selected-outline"]).toBe("1px solid var(--selected)");
    expect(storeThemes.noche.style["payment-selected-shadow"]).toBe("none");
  });

  test("does not clip the field group, so a field touching its edge keeps the whole focus ring", () => {
    const group = stylesheet.match(/data-store-part="field-group"\] \{([^{}]*)\}/)?.[1] ?? "";
    expect(group).toContain("border-radius");
    expect(group).not.toMatch(/overflow/);
  });

  test("keeps the total label on one line and lets a long amount move under it", () => {
    const rule = (part: string) => stylesheet.match(new RegExp(`data-store-part="${part}"\\] \\{([^{}]*)\\}`))?.[1] ?? "";
    expect(rule("total")).toContain("flex-wrap: wrap");
    expect(rule("total-label")).toContain("white-space: nowrap");
  });

  test("lets a native radio leave the focus ring to its option or payment chip", () => {
    expect(stylesheet).toContain('[data-slot="radio-group-item"]:not(input)):focus-visible');
    for (const part of ["option", "payment-method"]) expect(stylesheet).toMatch(new RegExp(`data-store-part="${part}"\\]:has\\(:focus-visible\\) \\{[^}]*outline-offset: ${part === "option" ? "-2px" : "2px"}`));
  });

  test("limits the main button size, border and shadow to the default variant", () => {
    const rule = (selector: string) => stylesheet.match(new RegExp(`${selector.replace(/[[\]"=().]/g, "\\$&")} \\{([^{}]*)\\}`))?.[1] ?? "";
    expect(rule('[data-store-theme] [data-slot="button"]')).not.toMatch(/height|box-shadow|border:/);
    expect(rule('[data-store-theme] [data-slot="button"][data-variant="default"]')).toMatch(/height[\s\S]*box-shadow/);
  });

  test("leaves the header justification to the brand row, since the bar itself spans the full width", () => {
    const header = stylesheet.match(/data-store-part="header"\] \{([^{}]*)\}/)?.[1] ?? "";
    expect(header).not.toContain("justify-content");
  });

  test("hooks only the closed list of checkout parts", () => {
    const parts = new Set([...stylesheet.matchAll(/data-store-part="([a-z-]+)"/g)].map((match) => match[1]));
    expect([...parts].sort()).toEqual(["card", "field", "field-group", "free", "header", "header-brand", "option", "option-cost", "option-group", "order-title",
      "payment-image", "payment-method", "price", "product-meta", "product-name", "product-row", "section-title", "status", "total", "total-amount", "total-label"]);
  });
});
