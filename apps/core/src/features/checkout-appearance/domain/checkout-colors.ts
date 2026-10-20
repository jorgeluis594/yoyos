import tokens from "@core/../../docs/design-tokens.json";
import type { CheckoutBackground, CheckoutBrandColor, HexColor } from "@core/src/features/checkout-appearance/domain/checkout-appearance";

export type CatalogTokens = Readonly<{
  primary: HexColor; "primary-foreground": HexColor; "primary-hover": HexColor; "primary-pressed": HexColor;
  ring: HexColor; accent: HexColor; "accent-foreground": HexColor; "brand-background": HexColor;
}>;
export type BrandColorDefinition = Readonly<{ name: string; light: CatalogTokens; dark: CatalogTokens }>;
export type CatalogPalette = Readonly<{
  light: CatalogTokens & Readonly<{ background: HexColor }>;
  dark: CatalogTokens & Readonly<{ background: HexColor }>;
}>;

/** The 15 tones each color writes per mode. */
export type CheckoutPaletteTones = Readonly<{
  soft: HexColor; medium: HexColor; "brand-background": HexColor;
  foreground: HexColor; card: HexColor; muted: HexColor; "muted-foreground": HexColor;
  border: HexColor; input: HexColor;
  primary: HexColor; "primary-foreground": HexColor; "primary-hover": HexColor; "primary-pressed": HexColor;
  accent: HexColor; "accent-foreground": HexColor;
}>;
export const checkoutTokenNames = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "primary-hover", "primary-pressed", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground", "border", "input", "ring"] as const;
export type CheckoutTokens = Readonly<Record<(typeof checkoutTokenNames)[number], HexColor>>;
export type CheckoutPalette = Readonly<{ light: CheckoutTokens; dark: CheckoutTokens }>;

/** Hex values are written in this file only; they never come from seller data. */
const hex = (value: string) => value as HexColor;

export const defaultCheckoutBrandColor: CheckoutBrandColor = "yoyos";

export const checkoutBrandColorCatalog: Readonly<Record<CheckoutBrandColor, BrandColorDefinition>> = {
  yoyos: { name: "Yoyos",
    light: { primary: hex("#8C552D"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#7A4A27"), "primary-pressed": hex("#6D4223"),
      ring: hex("#8C552D"), accent: hex("#EFE7E2"), "accent-foreground": hex("#8C552D"), "brand-background": hex("#F7EFE6") },
    dark: { primary: hex("#D5A16C"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#DEB58B"), "primary-pressed": hex("#E5C5A4"),
      ring: hex("#D5A16C"), accent: hex("#45382E"), "accent-foreground": hex("#D5A16C"), "brand-background": hex("#1F1B19") } },
  forest: { name: "Bosque",
    light: { primary: hex("#2F6B4F"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#295D45"), "primary-pressed": hex("#24523D"),
      ring: hex("#2F6B4F"), accent: hex("#E2EAE6"), "accent-foreground": hex("#2F6B4F"), "brand-background": hex("#F1F6F2") },
    dark: { primary: hex("#8FCBA8"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#AEDAC0"), "primary-pressed": hex("#CAE7D6"),
      ring: hex("#8FCBA8"), accent: hex("#35423C"), "accent-foreground": hex("#8FCBA8"), "brand-background": hex("#181E1B") } },
  petrol: { name: "Petróleo",
    light: { primary: hex("#13646B"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#11575D"), "primary-pressed": hex("#0E4C51"),
      ring: hex("#13646B"), accent: hex("#DEE9EA"), "accent-foreground": hex("#13646B"), "brand-background": hex("#EEF6F6") },
    dark: { primary: hex("#84CBD0"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#A8DADE"), "primary-pressed": hex("#C6E7E9"),
      ring: hex("#84CBD0"), accent: hex("#334244"), "accent-foreground": hex("#84CBD0"), "brand-background": hex("#161E1F") } },
  ocean: { name: "Océano",
    light: { primary: hex("#1F5A8C"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#1B4D78"), "primary-pressed": hex("#174469"),
      ring: hex("#1F5A8C"), accent: hex("#E0E8EF"), "accent-foreground": hex("#1F5A8C"), "brand-background": hex("#EFF4FA") },
    dark: { primary: hex("#8EBDE6"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#AACEEC"), "primary-pressed": hex("#C3DCF2"),
      ring: hex("#8EBDE6"), accent: hex("#353F49"), "accent-foreground": hex("#8EBDE6"), "brand-background": hex("#171C22") } },
  plum: { name: "Ciruela",
    light: { primary: hex("#6B3A7D"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#5B316A"), "primary-pressed": hex("#4D2A5A"),
      ring: hex("#6B3A7D"), accent: hex("#EAE3ED"), "accent-foreground": hex("#6B3A7D"), "brand-background": hex("#F6F1F8") },
    dark: { primary: hex("#C9A2D8"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#D5B6E1"), "primary-pressed": hex("#DFC8E8"),
      ring: hex("#C9A2D8"), accent: hex("#423946"), "accent-foreground": hex("#C9A2D8"), "brand-background": hex("#1E1921") } },
  raspberry: { name: "Frambuesa",
    light: { primary: hex("#A8305F"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#922A53"), "primary-pressed": hex("#812549"),
      ring: hex("#A8305F"), accent: hex("#F3E2E9"), "accent-foreground": hex("#A8305F"), "brand-background": hex("#FBF0F4") },
    dark: { primary: hex("#EE9BBB"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#F2B3CB"), "primary-pressed": hex("#F6C8DA"),
      ring: hex("#EE9BBB"), accent: hex("#4A3740"), "accent-foreground": hex("#EE9BBB"), "brand-background": hex("#221A1D") } },
  terracotta: { name: "Terracota",
    light: { primary: hex("#A4452A"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#903D25"), "primary-pressed": hex("#803621"),
      ring: hex("#A4452A"), accent: hex("#F2E5E1"), "accent-foreground": hex("#A4452A"), "brand-background": hex("#FBF2EE") },
    dark: { primary: hex("#EDA38A"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#F2BAA7"), "primary-pressed": hex("#F5CDC0"),
      ring: hex("#EDA38A"), accent: hex("#4A3935"), "accent-foreground": hex("#EDA38A"), "brand-background": hex("#221B19") } },
  mustard: { name: "Mostaza",
    light: { primary: hex("#7E5C00"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#6E5000"), "primary-pressed": hex("#614700"),
      ring: hex("#7E5C00"), accent: hex("#EDE8DB"), "accent-foreground": hex("#7E5C00"), "brand-background": hex("#FAF5E6") },
    dark: { primary: hex("#E3C063"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#ECD493"), "primary-pressed": hex("#F4E5BF"),
      ring: hex("#E3C063"), accent: hex("#483F2C"), "accent-foreground": hex("#E3C063"), "brand-background": hex("#201E17") } },
  graphite: { name: "Grafito",
    light: { primary: hex("#333238"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#252529"), "primary-pressed": hex("#18171A"),
      ring: hex("#333238"), accent: hex("#E2E2E3"), "accent-foreground": hex("#333238"), "brand-background": hex("#F4F4F5") },
    dark: { primary: hex("#C9C7CF"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#DBDADF"), "primary-pressed": hex("#ECEBEE"),
      ring: hex("#C9C7CF"), accent: hex("#424144"), "accent-foreground": hex("#C9C7CF"), "brand-background": hex("#1C1C1E") } },
};

const systemBackground = { light: hex(tokens.colors.light.background), dark: hex(tokens.colors.dark.background) };
const white = hex("#FFFFFF");

function lightBackground(background: CheckoutBackground, brandBackground: HexColor): HexColor {
  if (background === "soft") return white;
  return background === "medium" ? systemBackground.light : brandBackground;
}

function darkBackground(background: CheckoutBackground, brandBackground: HexColor): HexColor {
  return background === "brand_tint" ? brandBackground : systemBackground.dark;
}

/** The public catalog keeps painting with the eight tones and the background rule it had before the checkout palettes. */
export function catalogPalette(brandColor: CheckoutBrandColor, background: CheckoutBackground): CatalogPalette {
  const { light, dark } = checkoutBrandColorCatalog[brandColor];
  return {
    light: { ...light, background: lightBackground(background, light["brand-background"]) },
    dark: { ...dark, background: darkBackground(background, dark["brand-background"]) },
  };
}

const system = tokens.colors;
const yoyosTones = (mode: "light" | "dark", soft: string, brandBackground: string): CheckoutPaletteTones => ({
  soft: hex(soft), medium: hex(system[mode].background), "brand-background": hex(brandBackground),
  foreground: hex(system[mode].foreground), card: hex(system[mode].card), muted: hex(system[mode].muted), "muted-foreground": hex(system[mode]["muted-foreground"]),
  border: hex(system[mode].border), input: hex(system[mode].input),
  primary: hex(system[mode].primary), "primary-foreground": hex(system[mode]["primary-foreground"]),
  "primary-hover": hex(system[mode]["primary-hover"]), "primary-pressed": hex(system[mode]["primary-pressed"]),
  accent: hex(system[mode].accent), "accent-foreground": hex(system[mode]["accent-foreground"]),
});

/**
 * Yoyos takes the global design tokens. The other eight follow one OKLCH criterion (docs/apariencia-del-checkout-implementacion.md §15.6):
 * the hue of the main tone, the lightness of the shared scale and chroma = min(scale maximum, main tone chroma), rounded to HEX.
 */
export const checkoutColorPalettes: Readonly<Record<CheckoutBrandColor, Readonly<{ light: CheckoutPaletteTones; dark: CheckoutPaletteTones }>>> = {
  yoyos: { light: yoyosTones("light", "#FFFDF9", "#FAE9DE"), dark: yoyosTones("dark", "#171310", "#2B2119") },
  forest: {
    light: {
      soft: hex("#F8FDFA"), medium: hex("#EAF5EF"), "brand-background": hex("#D8EEE2"),
      foreground: hex("#1F2522"), card: hex("#FFFFFF"), muted: hex("#D3E2DA"), "muted-foreground": hex("#526259"),
      border: hex("#BCD3C6"), input: hex("#637F70"),
      primary: hex("#2F6B4F"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#295D45"), "primary-pressed": hex("#24523D"),
      accent: hex("#D4EBDE"), "accent-foreground": hex("#2F6B4F"),
    },
    dark: {
      soft: hex("#121513"), medium: hex("#161D19"), "brand-background": hex("#19271F"),
      foreground: hex("#E3EBE6"), card: hex("#212824"), muted: hex("#303C35"), "muted-foreground": hex("#A1B3A8"),
      border: hex("#3F5247"), input: hex("#789483"),
      primary: hex("#8FCBA8"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#AEDAC0"), "primary-pressed": hex("#CAE7D6"),
      accent: hex("#273D30"), "accent-foreground": hex("#8FCBA8"),
    },
  },
  petrol: {
    light: {
      soft: hex("#F7FDFE"), medium: hex("#E8F5F6"), "brand-background": hex("#D3EEF0"),
      foreground: hex("#1D2526"), card: hex("#FFFFFF"), muted: hex("#D0E2E4"), "muted-foreground": hex("#4D6264"),
      border: hex("#B6D2D5"), input: hex("#5B7F82"),
      primary: hex("#13646B"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#11575D"), "primary-pressed": hex("#0E4C51"),
      accent: hex("#CFEBEE"), "accent-foreground": hex("#13646B"),
    },
    dark: {
      soft: hex("#111515"), medium: hex("#131D1E"), "brand-background": hex("#142728"),
      foreground: hex("#E0EBEC"), card: hex("#1F2828"), muted: hex("#2C3C3D"), "muted-foreground": hex("#9CB3B4"),
      border: hex("#3A5254"), input: hex("#709496"),
      primary: hex("#84CBD0"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#A8DADE"), "primary-pressed": hex("#C6E7E9"),
      accent: hex("#1F3C3E"), "accent-foreground": hex("#84CBD0"),
    },
  },
  ocean: {
    light: {
      soft: hex("#F9FCFF"), medium: hex("#EBF3FB"), "brand-background": hex("#DAEAFA"),
      foreground: hex("#1F2429"), card: hex("#FFFFFF"), muted: hex("#D4E0EB"), "muted-foreground": hex("#535F6B"),
      border: hex("#BDCEDF"), input: hex("#657A8E"),
      primary: hex("#1F5A8C"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#1B4D78"), "primary-pressed": hex("#174469"),
      accent: hex("#D6E7F8"), "accent-foreground": hex("#1F5A8C"),
    },
    dark: {
      soft: hex("#121416"), medium: hex("#161C21"), "brand-background": hex("#19242E"),
      foreground: hex("#E3EAF1"), card: hex("#21272C"), muted: hex("#303A42"), "muted-foreground": hex("#A1B0BD"),
      border: hex("#404F5D"), input: hex("#788FA3"),
      primary: hex("#8EBDE6"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#AACEEC"), "primary-pressed": hex("#C3DCF2"),
      accent: hex("#283948"), "accent-foreground": hex("#8EBDE6"),
    },
  },
  plum: {
    light: {
      soft: hex("#FDFBFF"), medium: hex("#F6EFF8"), "brand-background": hex("#EFE3F5"),
      foreground: hex("#262227"), card: hex("#FFFFFF"), muted: hex("#E3DAE7"), "muted-foreground": hex("#635967"),
      border: hex("#D4C7DA"), input: hex("#817088"),
      primary: hex("#6B3A7D"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#5B316A"), "primary-pressed": hex("#4D2A5A"),
      accent: hex("#EDDFF2"), "accent-foreground": hex("#6B3A7D"),
    },
    dark: {
      soft: hex("#151316"), medium: hex("#1E191F"), "brand-background": hex("#28202B"),
      foreground: hex("#ECE6EE"), card: hex("#28242A"), muted: hex("#3D3540"), "muted-foreground": hex("#B4A9B9"),
      border: hex("#544858"), input: hex("#96859D"),
      primary: hex("#C9A2D8"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#D5B6E1"), "primary-pressed": hex("#DFC8E8"),
      accent: hex("#3E3143"), "accent-foreground": hex("#C9A2D8"),
    },
  },
  raspberry: {
    light: {
      soft: hex("#FFFAFB"), medium: hex("#FBEEF1"), "brand-background": hex("#F9E1E7"),
      foreground: hex("#292123"), card: hex("#FFFFFF"), muted: hex("#EAD9DD"), "muted-foreground": hex("#6A585D"),
      border: hex("#DEC4CB"), input: hex("#8C6E76"),
      primary: hex("#A8305F"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#922A53"), "primary-pressed": hex("#812549"),
      accent: hex("#F7DDE3"), "accent-foreground": hex("#A8305F"),
    },
    dark: {
      soft: hex("#161314"), medium: hex("#21181B"), "brand-background": hex("#2D1E24"),
      foreground: hex("#F0E6E9"), card: hex("#2B2426"), muted: hex("#413439"), "muted-foreground": hex("#BCA8AF"),
      border: hex("#5B464E"), input: hex("#A1828D"),
      primary: hex("#EE9BBB"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#F2B3CB"), "primary-pressed": hex("#F6C8DA"),
      accent: hex("#462F38"), "accent-foreground": hex("#EE9BBB"),
    },
  },
  terracotta: {
    light: {
      soft: hex("#FFFAF9"), medium: hex("#FBEFEB"), "brand-background": hex("#FAE2DB"),
      foreground: hex("#29221F"), card: hex("#FFFFFF"), muted: hex("#EBDAD5"), "muted-foreground": hex("#6B5954"),
      border: hex("#DFC6BF"), input: hex("#8D7067"),
      primary: hex("#A4452A"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#903D25"), "primary-pressed": hex("#803621"),
      accent: hex("#F8DED7"), "accent-foreground": hex("#A4452A"),
    },
    dark: {
      soft: hex("#161312"), medium: hex("#211916"), "brand-background": hex("#2D1F1A"),
      foreground: hex("#F0E6E3"), card: hex("#2B2422"), muted: hex("#423531"), "muted-foreground": hex("#BDA9A2"),
      border: hex("#5C4841"), input: hex("#A2847A"),
      primary: hex("#EDA38A"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#F2BAA7"), "primary-pressed": hex("#F5CDC0"),
      accent: hex("#473129"), "accent-foreground": hex("#EDA38A"),
    },
  },
  mustard: {
    light: {
      soft: hex("#FEFBF7"), medium: hex("#F6F1E7"), "brand-background": hex("#F1E7D3"),
      foreground: hex("#26231D"), card: hex("#FFFFFF"), muted: hex("#E4DDCF"), "muted-foreground": hex("#645D4E"),
      border: hex("#D6CBB7"), input: hex("#83765D"),
      primary: hex("#7E5C00"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#6E5000"), "primary-pressed": hex("#614700"),
      accent: hex("#EEE3CF"), "accent-foreground": hex("#7E5C00"),
    },
    dark: {
      soft: hex("#151411"), medium: hex("#1E1B14"), "brand-background": hex("#282316"),
      foreground: hex("#ECE9E0"), card: hex("#28261F"), muted: hex("#3D382D"), "muted-foreground": hex("#B4AD9C"),
      border: hex("#544C3A"), input: hex("#968B71"),
      primary: hex("#E3C063"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#ECD493"), "primary-pressed": hex("#F4E5BF"),
      accent: hex("#3E3622"), "accent-foreground": hex("#E3C063"),
    },
  },
  graphite: {
    light: {
      soft: hex("#FCFBFF"), medium: hex("#F2F1F8"), "brand-background": hex("#E8E7EE"),
      foreground: hex("#242328"), card: hex("#FFFFFF"), muted: hex("#DEDDE5"), "muted-foreground": hex("#5E5D63"),
      border: hex("#CCCBD3"), input: hex("#77767D"),
      primary: hex("#333238"), "primary-foreground": hex("#FFFFFF"), "primary-hover": hex("#252529"), "primary-pressed": hex("#18171A"),
      accent: hex("#E5E3EB"), "accent-foreground": hex("#333238"),
    },
    dark: {
      soft: hex("#141316"), medium: hex("#1C1A20"), "brand-background": hex("#242228"),
      foreground: hex("#E9E7F0"), card: hex("#26252B"), muted: hex("#39373E"), "muted-foreground": hex("#AEACB4"),
      border: hex("#4E4C53"), input: hex("#8D8B92"),
      primary: hex("#C9C7CF"), "primary-foreground": hex("#1C1B1D"), "primary-hover": hex("#DBDADF"), "primary-pressed": hex("#ECEBEE"),
      accent: hex("#37363C"), "accent-foreground": hex("#C9C7CF"),
    },
  },
};

const aliases = (tones: CheckoutPaletteTones, background: HexColor): CheckoutTokens => ({
  background, foreground: tones.foreground, card: tones.card, "card-foreground": tones.foreground,
  popover: tones.card, "popover-foreground": tones.foreground,
  primary: tones.primary, "primary-foreground": tones["primary-foreground"], "primary-hover": tones["primary-hover"], "primary-pressed": tones["primary-pressed"],
  secondary: tones.muted, "secondary-foreground": tones.foreground, muted: tones.muted, "muted-foreground": tones["muted-foreground"],
  accent: tones.accent, "accent-foreground": tones["accent-foreground"], border: tones.border, input: tones.input, ring: tones.primary,
});

const backgroundTone = { soft: "soft", medium: "medium", brand_tint: "brand-background" } as const;

export function checkoutPalette(brandColor: CheckoutBrandColor, background: CheckoutBackground): CheckoutPalette {
  const { light, dark } = checkoutColorPalettes[brandColor];
  const tone = backgroundTone[background];
  return { light: aliases(light, light[tone]), dark: aliases(dark, dark[tone]) };
}
