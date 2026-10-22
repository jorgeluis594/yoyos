import { describe, expect, test } from "vitest";
import {
  storeColorTokens, storeStyleTokens, storeThemeIds, storeThemes, defaultStoreTheme, type StoreThemeDefinition,
} from "@shared/store-themes";

const channel = (hex: string, start: number) => {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const themes = storeThemeIds.map((id) => storeThemes[id]);
const textFloor = 4.5;
const boundaryFloor = 3;
/** The page behind the checkout: the solid background and every stop of a gradient. */
const pageSurfaces = (theme: StoreThemeDefinition) => [theme.colors.background, ...(theme.backgroundImage?.stops ?? [])];
const cardAndPage = (theme: StoreThemeDefinition) => [...pageSurfaces(theme), theme.colors.card];

type Pair = Readonly<{ label: string; foreground: string; surface: string }>;
function textPairs(theme: StoreThemeDefinition): Pair[] {
  const { colors } = theme;
  const pairs: Pair[] = [];
  for (const token of ["foreground", "heading", "muted-foreground", "label", "placeholder", "free"] as const)
    for (const surface of cardAndPage(theme)) pairs.push({ label: `${token} on ${surface}`, foreground: colors[token], surface });
  for (const token of ["foreground", "placeholder"] as const) pairs.push({ label: `${token} on input-surface`, foreground: colors[token], surface: colors["input-surface"] });
  pairs.push({ label: "link on card", foreground: colors.link, surface: colors.card });
  // A checked option or payment method paints its text on the selected surface; the select highlight paints on accent.
  for (const token of ["muted-foreground", "free"] as const) pairs.push({ label: `${token} on selected-surface`, foreground: colors[token], surface: colors["selected-surface"] });
  pairs.push({ label: "foreground on accent", foreground: colors.foreground, surface: colors.accent });
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
function boundaryPairs(theme: StoreThemeDefinition): Pair[] {
  const { colors } = theme;
  const pairs: Pair[] = [];
  for (const surface of [colors["input-surface"], ...cardAndPage(theme)]) pairs.push({ label: `input on ${surface}`, foreground: colors.input, surface });
  for (const token of ["control", "selected", "ring"] as const)
    for (const surface of cardAndPage(theme)) pairs.push({ label: `${token} on ${surface}`, foreground: colors[token], surface });
  // Radio dot, focus ring around a field, invalid-field border, and the selected border against its own fill.
  for (const [token, surface] of [["accent-strong", colors["input-surface"]], ["ring", colors["input-surface"]], ["destructive", colors["input-surface"]], ["selected", colors["selected-surface"]]] as const)
    pairs.push({ label: `${token} on ${surface}`, foreground: colors[token], surface });
  for (const surface of cardAndPage(theme)) {
    pairs.push({ label: `accent-strong on ${surface}`, foreground: colors["accent-strong"], surface });
    pairs.push({ label: `destructive on ${surface}`, foreground: colors.destructive, surface });
  }
  return pairs;
}

describe("checkout themes", () => {
  test("defines the five themes in the order Clásico, Boutique, Antojo, Suave, Noche with Clásico as default", () => {
    expect(storeThemeIds).toEqual(["classic", "boutique", "antojo", "suave", "noche"]);
    expect(themes.map((theme) => theme.name)).toEqual(["Clásico", "Boutique", "Antojo", "Suave", "Noche"]);
    expect(themes.map((theme) => theme.id)).toEqual([...storeThemeIds]);
    expect(defaultStoreTheme).toBe("classic");
  });

  test("defines every color and style token in every theme", () => {
    for (const theme of themes) {
      expect(Object.keys(theme.colors).sort(), theme.id).toEqual([...storeColorTokens].sort());
      expect(Object.keys(theme.style).sort(), theme.id).toEqual([...storeStyleTokens].sort());
      for (const [token, value] of Object.entries(theme.style)) expect(value.trim(), `${theme.id} ${token}`).not.toBe("");
    }
  });

  test("makes Noche dark and the other four themes light", () => {
    expect(themes.map((theme) => theme.mode)).toEqual(["light", "light", "light", "light", "dark"]);
  });

  test("meets 4.5:1 for every text pair of every theme, including each stop of Suave's gradient", () => {
    expect(storeThemes.suave.backgroundImage?.stops).toHaveLength(3);
    for (const theme of themes) for (const pair of textPairs(theme))
      expect(contrast(pair.foreground, pair.surface), `${theme.id}: ${pair.label}`).toBeGreaterThanOrEqual(textFloor);
  });

  test("meets 3:1 for field, control, selected and focus boundaries against card and background in every theme", () => {
    for (const theme of themes) for (const pair of boundaryPairs(theme))
      expect(contrast(pair.foreground, pair.surface), `${theme.id}: ${pair.label}`).toBeGreaterThanOrEqual(boundaryFloor);
  });

  test("keeps shadcn's soft accent and carries the strong accent of each theme in its own token", () => {
    for (const theme of themes) {
      expect(theme.colors.accent, theme.id).toBe(theme.colors["selected-surface"]);
      expect(theme.colors["accent-foreground"], theme.id).toBe(theme.colors.foreground);
    }
    expect(themes.map((theme) => theme.colors["accent-strong"])).toEqual(["#111111", "#141210", "#F75348", "#1F1A1C", "#3CC8E8"]);
  });

  test("keeps Antojo's coral button with dark brown text", () => {
    expect(storeThemes.antojo.colors.primary).toBe("#FF5A4E");
    expect(storeThemes.antojo.colors["primary-foreground"]).toBe("#2A1A12");
  });

  test("shows an 8:1 logo at least 24 px tall on a 390 px phone and leaves the store name 96 px beside it", () => {
    const phone = 390, gutter = 16, gap = 12, rem = 16;
    const px = (value: string) => value.endsWith("rem") ? parseFloat(value) * rem : parseFloat(value) || 0;
    const plateWidth = (maxWidth: string) => {
      const [, cap, inset] = /^min\(([\d.]+rem), 100vw - ([\d.]+rem)\)$/.exec(maxWidth) ?? [];
      expect(cap, maxWidth).toBeDefined();
      return Math.min(px(cap), phone - px(inset));
    };
    for (const { id, logo } of themes) {
      const [vertical, horizontal = vertical] = logo.padding.split(" ").map(px);
      const border = logo.border === "none" ? 0 : px(logo.border);
      const width = plateWidth(logo.maxWidth);
      const logoHeight = Math.min(px(logo.height) - 2 * (vertical + border), (width - 2 * (horizontal + border)) / 8);
      expect(logoHeight, id).toBeGreaterThanOrEqual(24);
      if (logo.direction === "row") expect(phone - 2 * gutter - gap - width, id).toBeGreaterThanOrEqual(96);
      else expect(width, id).toBeLessThanOrEqual(phone - 2 * gutter);
    }
  });

  test("uses a serif family only for Boutique headings and product names", () => {
    for (const theme of themes) {
      const serif = Object.entries(theme.fonts).filter(([, family]) => family === "playfair-display").map(([role]) => role);
      expect(serif, theme.id).toEqual(theme.id === "boutique" ? ["heading", "productName"] : []);
    }
    expect(storeThemes.boutique.fonts).toMatchObject({ body: "inter", button: "inter" });
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
