import { describe, expect, test } from "vitest";
import tokens from "@core/../../docs/design-tokens.json";
import { checkoutBackgrounds, checkoutBrandColors } from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { checkoutBrandColorCatalog, checkoutPalette, defaultCheckoutBrandColor } from "@core/src/features/checkout-appearance/domain/checkout-colors";

const channel = (hex: string, start: number) => {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const modes = ["light", "dark"] as const;
const system = { light: tokens.colors.light, dark: tokens.colors.dark };
const matrix = checkoutBrandColors.flatMap((color) => checkoutBackgrounds.flatMap((background) =>
  modes.map((mode) => ({ label: `${color} · ${background} · ${mode}`, color, background, mode }))));

const productDefinition = {
  yoyos: ["#8C552D", "#F7EFE6", "#D5A16C", "#1F1B19"],
  forest: ["#2F6B4F", "#F1F6F2", "#8FCBA8", "#181E1B"],
  petrol: ["#13646B", "#EEF6F6", "#84CBD0", "#161E1F"],
  ocean: ["#1F5A8C", "#EFF4FA", "#8EBDE6", "#171C22"],
  plum: ["#6B3A7D", "#F6F1F8", "#C9A2D8", "#1E1921"],
  raspberry: ["#A8305F", "#FBF0F4", "#EE9BBB", "#221A1D"],
  terracotta: ["#A4452A", "#FBF2EE", "#EDA38A", "#221B19"],
  mustard: ["#7E5C00", "#FAF5E6", "#E3C063", "#201E17"],
  graphite: ["#333238", "#F4F4F5", "#C9C7CF", "#1C1C1E"],
} as const;

function resolve(color: (typeof checkoutBrandColors)[number], background: (typeof checkoutBackgrounds)[number], mode: "light" | "dark") {
  return checkoutPalette(color, background)[mode];
}

describe("catalog", () => {
  test("defines every color of CheckoutBrandColor with light and dark tokens", () => {
    expect(Object.keys(checkoutBrandColorCatalog).sort()).toEqual([...checkoutBrandColors].sort());
    for (const color of checkoutBrandColors) for (const mode of modes)
      expect(Object.keys(checkoutBrandColorCatalog[color][mode]).sort()).toEqual(
        ["accent", "accent-foreground", "brand-background", "primary", "primary-foreground", "primary-hover", "primary-pressed", "ring"]);
  });

  test("matches the base tones of the product definition", () => {
    for (const color of checkoutBrandColors) {
      const { light, dark } = checkoutBrandColorCatalog[color];
      expect([light.primary, light["brand-background"], dark.primary, dark["brand-background"]]).toEqual(productDefinition[color]);
    }
  });

  test("uses Yoyos as the default color", () => {
    expect(defaultCheckoutBrandColor).toBe("yoyos");
  });

  test("uses the system text color on buttons: white in light mode and near black in dark mode", () => {
    for (const color of checkoutBrandColors) {
      expect(checkoutBrandColorCatalog[color].light["primary-foreground"]).toBe(system.light["primary-foreground"]);
      expect(checkoutBrandColorCatalog[color].dark["primary-foreground"]).toBe(system.dark["primary-foreground"]);
    }
  });
});

describe("primary color", () => {
  test.each(matrix)("is readable as text on the page, cards and its brand background · $label", ({ color, background, mode }) => {
    const palette = resolve(color, background, mode);
    for (const surface of [palette.background, system[mode].card, system[mode].background, palette["brand-background"]])
      expect(contrast(palette.primary, surface)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(matrix)("keeps button text readable on primary, hover and pressed · $label", ({ color, background, mode }) => {
    const palette = resolve(color, background, mode);
    for (const fill of [palette.primary, palette["primary-hover"], palette["primary-pressed"]])
      expect(contrast(palette["primary-foreground"], fill)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(matrix)("makes hover and pressed visibly different from primary · $label", ({ color, background, mode }) => {
    const palette = resolve(color, background, mode);
    expect(contrast(palette["primary-hover"], palette.primary)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(palette["primary-pressed"], palette.primary)).toBeGreaterThanOrEqual(1.3);
  });
});

describe("focus ring", () => {
  test.each(matrix)("reaches 3:1 against the page and cards · $label", ({ color, background, mode }) => {
    const palette = resolve(color, background, mode);
    expect(contrast(palette.ring, palette.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(palette.ring, system[mode].card)).toBeGreaterThanOrEqual(3);
  });
});

describe("accent surface", () => {
  test.each(matrix)("keeps accent and system text readable on it · $label", ({ color, background, mode }) => {
    const palette = resolve(color, background, mode);
    expect(contrast(palette["accent-foreground"], palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(system[mode].foreground, palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(system[mode]["muted-foreground"], palette.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("page background", () => {
  test("is pure white for the white option in light mode", () => {
    for (const color of checkoutBrandColors) expect(checkoutPalette(color, "white").light.background).toBe("#FFFFFF");
  });

  test("keeps the system dark background for the white option in dark mode", () => {
    for (const color of checkoutBrandColors) expect(checkoutPalette(color, "white").dark.background).toBe(system.dark.background);
  });

  test("keeps the system background for the neutral option", () => {
    for (const color of checkoutBrandColors) {
      expect(checkoutPalette(color, "neutral").light.background).toBe(system.light.background);
      expect(checkoutPalette(color, "neutral").dark.background).toBe(system.dark.background);
    }
  });

  test("uses the brand background of the color for the brand option in both modes", () => {
    for (const color of checkoutBrandColors) {
      const palette = checkoutPalette(color, "brand_tint");
      expect(palette.light.background).toBe(checkoutBrandColorCatalog[color].light["brand-background"]);
      expect(palette.dark.background).toBe(checkoutBrandColorCatalog[color].dark["brand-background"]);
    }
  });

  test.each(matrix)("keeps system text and muted text readable on it · $label", ({ color, background, mode }) => {
    const palette = resolve(color, background, mode);
    expect(contrast(system[mode].foreground, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(system[mode]["muted-foreground"], palette.background)).toBeGreaterThanOrEqual(4.5);
  });
});
