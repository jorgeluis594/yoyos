import { describe, expect, test } from "vitest";
import tokens from "@core/../../docs/design-tokens.json";
import { checkoutBackgrounds, checkoutBrandColors, type CheckoutBrandColor } from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import {
  catalogPalette, checkoutBrandColorCatalog, checkoutColorPalettes, checkoutPalette, checkoutTokenNames, defaultCheckoutBrandColor,
} from "@core/src/features/checkout-appearance/domain/checkout-colors";

const channel = (hex: string, start: number) => {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function oklab(hex: string) {
  const [r, g, b] = [1, 3, 5].map((start) => channel(hex, start));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s] as const;
}
function oklch(hex: string) {
  const [L, a, b] = oklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}
const distance = (a: string, b: string) => Math.hypot(...oklab(a).map((value, index) => value - oklab(b)[index]));
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

type Mode = "light" | "dark";
const modes = ["light", "dark"] as const;
const system = { light: tokens.colors.light, dark: tokens.colors.dark };
const derivedColors = checkoutBrandColors.filter((color) => color !== "yoyos");
const label = (color: string, background: string, mode: string) => `${color} · ${background} · ${mode}`;
const matrix = checkoutBrandColors.flatMap((color) => checkoutBackgrounds.flatMap((background) =>
  modes.map((mode) => ({ label: label(color, background, mode), color, background, mode }))));
const colorModes = checkoutBrandColors.flatMap((color) => modes.map((mode) => ({ label: `${color} · ${mode}`, color, mode })));
const derivedModes = derivedColors.flatMap((color) => modes.map((mode) => ({ label: `${color} · ${mode}`, color, mode })));

/** Shared scale of the design: lightness and maximum chroma of every derived tone (docs §15.6). */
const scale: Record<Mode, Readonly<Record<string, readonly [number, number]>>> = {
  light: { soft: [0.985, 0.006], medium: [0.968, 0.012], "brand-background": [0.945, 0.024], foreground: [0.258, 0.012], muted: [0.930, 0.014],
    "muted-foreground": [0.497, 0.025], border: [0.873, 0.020], input: [0.602, 0.030], accent: [0.920, 0.030] },
  dark: { soft: [0.205, 0.006], medium: [0.224, 0.012], "brand-background": [0.245, 0.020], card: [0.268, 0.012], foreground: [0.933, 0.012],
    muted: [0.309, 0.014], "muted-foreground": [0.750, 0.025], border: [0.388, 0.020], input: [0.608, 0.030], accent: [0.336, 0.035] },
};
const lightnessTolerance = 0.02;
const hueTolerance = 20;
const minimumChromaForHue = 0.005;
const chromaRoundingTolerance = 0.003; // HEX rounding moves chroma slightly
const minimumDistanceBetweenBackgrounds = 0.015;
const minimumDecorativeBorder = 1.15;

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

const semanticPrefixes = ["destructive", "success", "warning", "error", "info"];
const tonesOf = (color: CheckoutBrandColor, mode: Mode) => checkoutColorPalettes[color][mode];

describe("palettes", () => {
  test("defines the same tones for every color in light and dark mode", () => {
    expect(Object.keys(checkoutColorPalettes).sort()).toEqual([...checkoutBrandColors].sort());
    const names = Object.keys(tonesOf("yoyos", "light")).sort();
    expect(names).toHaveLength(15);
    for (const color of checkoutBrandColors) for (const mode of modes) expect(Object.keys(tonesOf(color, mode)).sort(), label(color, "", mode)).toEqual(names);
  });

  test("keeps the main tones of the product definition", () => {
    for (const color of checkoutBrandColors)
      expect([tonesOf(color, "light").primary, tonesOf(color, "dark").primary], color).toEqual([productDefinition[color][0], productDefinition[color][2]]);
  });

  test("uses the global Yoyos tokens for the Yoyos palette, with Medio as the system background", () => {
    for (const mode of modes) {
      const tones = tonesOf("yoyos", mode);
      const global = system[mode];
      expect(tones.medium).toBe(global.background);
      for (const name of ["foreground", "card", "muted", "muted-foreground", "border", "input", "primary", "primary-foreground", "primary-hover", "primary-pressed", "accent", "accent-foreground"] as const)
        expect(tones[name], `yoyos · ${mode} · ${name}`).toBe(global[name]);
      const palette = checkoutPalette("yoyos", "medium")[mode];
      for (const name of checkoutTokenNames) expect(palette[name], `yoyos · medium · ${mode} · ${name}`).toBe(global[name]);
    }
  });

  test("uses white cards in light mode for every color", () => {
    for (const color of checkoutBrandColors) expect(tonesOf(color, "light").card, color).toBe("#FFFFFF");
  });

  test("uses white text on buttons in light mode and near black in dark mode", () => {
    for (const color of checkoutBrandColors) {
      expect(tonesOf(color, "light")["primary-foreground"], color).toBe(system.light["primary-foreground"]);
      expect(tonesOf(color, "dark")["primary-foreground"], color).toBe(system.dark["primary-foreground"]);
    }
  });

  test("expands the tones into every token the checkout uses and no semantic token", () => {
    for (const color of checkoutBrandColors) for (const background of checkoutBackgrounds) for (const mode of modes) {
      const tones = tonesOf(color, mode);
      const palette = checkoutPalette(color, background)[mode];
      expect(Object.keys(palette).sort(), label(color, background, mode)).toEqual([...checkoutTokenNames].sort());
      expect(checkoutTokenNames.some((name) => semanticPrefixes.some((prefix) => name.startsWith(prefix)))).toBe(false);
      expect(palette["card-foreground"]).toBe(tones.foreground);
      expect(palette["popover-foreground"]).toBe(tones.foreground);
      expect(palette["secondary-foreground"]).toBe(tones.foreground);
      expect(palette.popover).toBe(tones.card);
      expect(palette.secondary).toBe(tones.muted);
      expect(palette.ring).toBe(tones.primary);
    }
  });
});

describe("palette construction", () => {
  test.each(derivedModes)("$label places every derived tone at the lightness of the shared scale", ({ color, mode }) => {
    const tones = tonesOf(color, mode);
    for (const [name, [lightness]] of Object.entries(scale[mode])) {
      expect(Math.abs(oklch(tones[name as keyof typeof tones]).L - lightness), `${name} of ${color} in ${mode}`).toBeLessThanOrEqual(lightnessTolerance);
    }
  });

  test.each(derivedModes)("$label caps the chroma of every derived tone at the scale maximum and the chroma of its main tone", ({ color, mode }) => {
    const tones = tonesOf(color, mode);
    const mainChroma = oklch(tones.primary).C;
    for (const [name, [, maximum]] of Object.entries(scale[mode]))
      expect(oklch(tones[name as keyof typeof tones]).C, `${name} of ${color} in ${mode}`).toBeLessThanOrEqual(Math.min(maximum, mainChroma) + chromaRoundingTolerance);
  });

  test.each(derivedModes)("$label derives every tinted tone from the hue of its main tone", ({ color, mode }) => {
    const tones = tonesOf(color, mode);
    const mainHue = oklch(tones.primary).h;
    for (const name of Object.keys(scale[mode])) {
      const tone = oklch(tones[name as keyof typeof tones]);
      if (tone.C < minimumChromaForHue) continue;
      expect(hueGap(tone.h, mainHue), `${name} of ${color} in ${mode}`).toBeLessThanOrEqual(hueTolerance);
    }
  });
});

describe("backgrounds", () => {
  test("maps Suave, Medio and De marca to their tones of the chosen palette", () => {
    for (const color of checkoutBrandColors) for (const mode of modes) {
      const tones = tonesOf(color, mode);
      expect(checkoutPalette(color, "soft")[mode].background, label(color, "soft", mode)).toBe(tones.soft);
      expect(checkoutPalette(color, "medium")[mode].background, label(color, "medium", mode)).toBe(tones.medium);
      expect(checkoutPalette(color, "brand_tint")[mode].background, label(color, "brand_tint", mode)).toBe(tones["brand-background"]);
    }
  });

  test.each(colorModes)("$label orders Suave, Medio and De marca from the most sober to the most tinted", ({ color, mode }) => {
    const [soft, medium, tint] = (["soft", "medium", "brand-background"] as const).map((name) => oklch(tonesOf(color, mode)[name]).L);
    if (mode === "light") { expect(soft, "Suave over Medio").toBeGreaterThan(medium); expect(medium, "Medio over De marca").toBeGreaterThan(tint); }
    else { expect(soft, "Suave under Medio").toBeLessThan(medium); expect(medium, "Medio under De marca").toBeLessThan(tint); }
  });

  test.each(colorModes)("$label keeps the three backgrounds visibly distinct", ({ color, mode }) => {
    const tones = tonesOf(color, mode);
    expect(distance(tones.soft, tones.medium), "Suave and Medio").toBeGreaterThanOrEqual(minimumDistanceBetweenBackgrounds);
    expect(distance(tones.medium, tones["brand-background"]), "Medio and De marca").toBeGreaterThanOrEqual(minimumDistanceBetweenBackgrounds);
  });

  test("never uses pure white or an untinted gray as a background", () => {
    for (const color of checkoutBrandColors) for (const mode of modes) for (const name of ["soft", "medium", "brand-background"] as const) {
      if (color === "yoyos" && name === "medium") continue; // The system background, by product rule.
      const value = tonesOf(color, mode)[name];
      expect(value, `${name} of ${color} in ${mode}`).not.toBe("#FFFFFF");
      expect(oklch(value).C, `${name} of ${color} in ${mode}`).toBeGreaterThanOrEqual(0.004);
    }
  });
});

describe("contrast", () => {
  test.each(matrix)("$label main and secondary text reach 4.5:1 on the page, cards and muted areas", ({ color, background, mode }) => {
    const palette = checkoutPalette(color, background)[mode];
    for (const [surfaceName, surface] of [["page", palette.background], ["card", palette.card], ["muted area", palette.muted]] as const) {
      expect(contrast(palette.foreground, surface), `foreground on ${surfaceName}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette["muted-foreground"], surface), `muted-foreground on ${surfaceName}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test.each(matrix)("$label button text reaches 4.5:1 on primary, hover and pressed", ({ color, background, mode }) => {
    const palette = checkoutPalette(color, background)[mode];
    for (const fill of ["primary", "primary-hover", "primary-pressed"] as const)
      expect(contrast(palette["primary-foreground"], palette[fill]), `primary-foreground on ${fill}`).toBeGreaterThanOrEqual(4.5);
  });

  test.each(matrix)("$label brand-colored links reach 4.5:1 on the page, cards and the selection highlight", ({ color, background, mode }) => {
    const palette = checkoutPalette(color, background)[mode];
    for (const [surfaceName, surface] of [["page", palette.background], ["card", palette.card], ["selection highlight", palette.accent]] as const)
      expect(contrast(palette.primary, surface), `primary on ${surfaceName}`).toBeGreaterThanOrEqual(4.5);
  });

  test.each(matrix)("$label selection highlight text reaches 4.5:1 on its surface", ({ color, background, mode }) => {
    const palette = checkoutPalette(color, background)[mode];
    for (const text of ["accent-foreground", "foreground", "muted-foreground"] as const)
      expect(contrast(palette[text], palette.accent), `${text} on accent`).toBeGreaterThanOrEqual(4.5);
  });

  test.each(matrix)("$label field and control borders reach 3:1 on the page and cards", ({ color, background, mode }) => {
    const palette = checkoutPalette(color, background)[mode];
    expect(contrast(palette.input, palette.background), "input on page").toBeGreaterThanOrEqual(3);
    expect(contrast(palette.input, palette.card), "input on card").toBeGreaterThanOrEqual(3);
  });

  test.each(matrix)("$label the focus ring reaches 3:1 on the page and cards", ({ color, background, mode }) => {
    const palette = checkoutPalette(color, background)[mode];
    expect(contrast(palette.ring, palette.background), "ring on page").toBeGreaterThanOrEqual(3);
    expect(contrast(palette.ring, palette.card), "ring on card").toBeGreaterThanOrEqual(3);
  });

  test.each(matrix)("$label decorative borders stay visible on the page and cards", ({ color, background, mode }) => {
    const palette = checkoutPalette(color, background)[mode];
    expect(contrast(palette.border, palette.background), "border on page").toBeGreaterThanOrEqual(minimumDecorativeBorder);
    expect(contrast(palette.border, palette.card), "border on card").toBeGreaterThanOrEqual(minimumDecorativeBorder);
  });

  test.each(colorModes)("$label hover and pressed are visibly different from primary", ({ color, mode }) => {
    const palette = checkoutPalette(color, "medium")[mode];
    expect(contrast(palette["primary-hover"], palette.primary), "primary-hover").toBeGreaterThanOrEqual(1.15);
    // Yoyos keeps the global tokens by product rule, and its dark pressed tone is 1.18:1 there.
    expect(contrast(palette["primary-pressed"], palette.primary), "primary-pressed").toBeGreaterThanOrEqual(color === "yoyos" ? 1.15 : 1.3);
  });
});

describe("public catalog palette", () => {
  test("keeps the pre-adjustment tones of every color", () => {
    expect(Object.keys(checkoutBrandColorCatalog).sort()).toEqual([...checkoutBrandColors].sort());
    for (const color of checkoutBrandColors) {
      const { light, dark } = checkoutBrandColorCatalog[color];
      expect(Object.keys(light).sort()).toEqual(["accent", "accent-foreground", "brand-background", "primary", "primary-foreground", "primary-hover", "primary-pressed", "ring"]);
      expect([light.primary, light["brand-background"], dark.primary, dark["brand-background"]], color).toEqual(productDefinition[color]);
    }
    expect(defaultCheckoutBrandColor).toBe("yoyos");
  });

  test("shows Suave as the former white background and Medio as the former neutral one", () => {
    for (const color of checkoutBrandColors) {
      expect(catalogPalette(color, "soft").light.background, color).toBe("#FFFFFF");
      expect(catalogPalette(color, "soft").dark.background, color).toBe(system.dark.background);
      expect(catalogPalette(color, "medium").light.background, color).toBe(system.light.background);
      expect(catalogPalette(color, "medium").dark.background, color).toBe(system.dark.background);
    }
  });

  test("keeps the former De marca background of each color", () => {
    for (const color of checkoutBrandColors) {
      const palette = catalogPalette(color, "brand_tint");
      expect(palette.light.background, color).toBe(checkoutBrandColorCatalog[color].light["brand-background"]);
      expect(palette.dark.background, color).toBe(checkoutBrandColorCatalog[color].dark["brand-background"]);
    }
  });
});
