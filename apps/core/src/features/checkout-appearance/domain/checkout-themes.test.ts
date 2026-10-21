import { describe, expect, test } from "vitest";
import {
  checkoutColorTokens, checkoutStyleTokens, checkoutThemeIds, checkoutThemes, defaultCheckoutTheme, type CheckoutThemeDefinition,
} from "@core/src/features/checkout-appearance/domain/checkout-themes";

const channel = (hex: string, start: number) => {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const themes = checkoutThemeIds.map((id) => checkoutThemes[id]);
const textFloor = 4.5;
const boundaryFloor = 3;
/** The page behind the checkout: the solid background and every stop of a gradient. */
const pageSurfaces = (theme: CheckoutThemeDefinition) => [theme.colors.background, ...(theme.backgroundImage?.stops ?? [])];
const cardAndPage = (theme: CheckoutThemeDefinition) => [...pageSurfaces(theme), theme.colors.card];

type Pair = Readonly<{ label: string; foreground: string; surface: string }>;
function textPairs(theme: CheckoutThemeDefinition): Pair[] {
  const { colors } = theme;
  const pairs: Pair[] = [];
  for (const token of ["foreground", "heading", "muted-foreground", "label", "placeholder", "free", "accent"] as const)
    for (const surface of cardAndPage(theme)) pairs.push({ label: `${token} on ${surface}`, foreground: colors[token], surface });
  for (const token of ["foreground", "placeholder"] as const) pairs.push({ label: `${token} on input-surface`, foreground: colors[token], surface: colors["input-surface"] });
  pairs.push({ label: "foreground on selected-surface", foreground: colors.foreground, surface: colors["selected-surface"] });
  for (const surface of ["primary", "primary-hover", "primary-pressed"] as const)
    pairs.push({ label: `primary-foreground on ${surface}`, foreground: colors["primary-foreground"], surface: colors[surface] });
  pairs.push({ label: "accent-foreground on accent", foreground: colors["accent-foreground"], surface: colors.accent });
  pairs.push({ label: "muted-foreground on thumbnail-surface", foreground: colors["muted-foreground"], surface: colors["thumbnail-surface"] });
  for (const token of ["success", "warning", "error", "info"] as const) {
    pairs.push({ label: `${token} on its surface`, foreground: colors[token], surface: colors[`${token}-surface`] });
    pairs.push({ label: `${token} on card`, foreground: colors[token], surface: colors.card });
  }
  pairs.push({ label: "destructive on card", foreground: colors.destructive, surface: colors.card });
  pairs.push({ label: "destructive-foreground on destructive", foreground: colors["destructive-foreground"], surface: colors.destructive });
  return pairs;
}
function boundaryPairs(theme: CheckoutThemeDefinition): Pair[] {
  const { colors } = theme;
  const pairs: Pair[] = [];
  for (const surface of [colors["input-surface"], ...cardAndPage(theme)]) pairs.push({ label: `input on ${surface}`, foreground: colors.input, surface });
  for (const token of ["control", "selected", "ring"] as const)
    for (const surface of cardAndPage(theme)) pairs.push({ label: `${token} on ${surface}`, foreground: colors[token], surface });
  return pairs;
}

describe("checkout themes", () => {
  test("defines the five themes in the order Clásico, Boutique, Antojo, Suave, Noche with Clásico as default", () => {
    expect(checkoutThemeIds).toEqual(["classic", "boutique", "antojo", "suave", "noche"]);
    expect(themes.map((theme) => theme.name)).toEqual(["Clásico", "Boutique", "Antojo", "Suave", "Noche"]);
    expect(themes.map((theme) => theme.id)).toEqual([...checkoutThemeIds]);
    expect(defaultCheckoutTheme).toBe("classic");
  });

  test("defines every color and style token in every theme", () => {
    for (const theme of themes) {
      expect(Object.keys(theme.colors).sort(), theme.id).toEqual([...checkoutColorTokens].sort());
      expect(Object.keys(theme.style).sort(), theme.id).toEqual([...checkoutStyleTokens].sort());
      for (const [token, value] of Object.entries(theme.style)) expect(value.trim(), `${theme.id} ${token}`).not.toBe("");
    }
  });

  test("makes Noche dark and the other four themes light", () => {
    expect(themes.map((theme) => theme.mode)).toEqual(["light", "light", "light", "light", "dark"]);
  });

  test("meets 4.5:1 for every text pair of every theme, including each stop of Suave's gradient", () => {
    expect(checkoutThemes.suave.backgroundImage?.stops).toHaveLength(3);
    for (const theme of themes) for (const pair of textPairs(theme))
      expect(contrast(pair.foreground, pair.surface), `${theme.id}: ${pair.label}`).toBeGreaterThanOrEqual(textFloor);
  });

  test("meets 3:1 for field, control, selected and focus boundaries against card and background in every theme", () => {
    for (const theme of themes) for (const pair of boundaryPairs(theme))
      expect(contrast(pair.foreground, pair.surface), `${theme.id}: ${pair.label}`).toBeGreaterThanOrEqual(boundaryFloor);
  });

  test("keeps Antojo's coral button with dark brown text", () => {
    expect(checkoutThemes.antojo.colors.primary).toBe("#FF5A4E");
    expect(checkoutThemes.antojo.colors["primary-foreground"]).toBe("#2A1A12");
  });

  test("uses a serif family only for Boutique headings and product names", () => {
    for (const theme of themes) {
      const serif = Object.entries(theme.fonts).filter(([, family]) => family === "playfair-display").map(([role]) => role);
      expect(serif, theme.id).toEqual(theme.id === "boutique" ? ["heading", "productName"] : []);
    }
    expect(checkoutThemes.boutique.fonts).toMatchObject({ body: "inter", button: "inter" });
  });

  test("sets the thumbnail size and ratio of each theme", () => {
    expect(themes.map((theme) => [theme.thumbnail.width, theme.thumbnail.ratio])).toEqual([
      ["56px", "1 / 1"], ["56px", "4 / 5"], ["76px", "1 / 1"], ["64px", "1 / 1"], ["48px", "1 / 1"],
    ]);
  });

  test("writes only opaque HEX colors", () => {
    const opaque = /^#[0-9A-F]{6}$/;
    for (const theme of themes) {
      for (const [token, value] of Object.entries(theme.colors)) expect(value, `${theme.id} ${token}`).toMatch(opaque);
      for (const stop of theme.backgroundImage?.stops ?? []) expect(stop, theme.id).toMatch(opaque);
      const writtenColors = [...Object.values(theme.style), ...Object.values(theme.logo), ...Object.values(theme.thumbnail)]
        .flatMap((value) => value.match(/#[0-9a-fA-F]+|(?:rgb|hsl)a?\([^)]*\)/g) ?? [])
        .filter((color) => !color.startsWith("rgba("));
      for (const color of writtenColors) expect(color, theme.id).toMatch(opaque);
    }
  });
});
