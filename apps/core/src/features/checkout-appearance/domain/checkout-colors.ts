import tokens from "@core/../../docs/design-tokens.json";
import type { CheckoutBackground, CheckoutBrandColor, HexColor } from "@core/src/features/checkout-appearance/domain/checkout-appearance";

export type CheckoutTokens = Readonly<{
  primary: HexColor; "primary-foreground": HexColor; "primary-hover": HexColor; "primary-pressed": HexColor;
  ring: HexColor; accent: HexColor; "accent-foreground": HexColor; "brand-background": HexColor;
}>;
export type BrandColorDefinition = Readonly<{ name: string; light: CheckoutTokens; dark: CheckoutTokens }>;
export type CheckoutPalette = Readonly<{
  light: CheckoutTokens & Readonly<{ background: HexColor }>;
  dark: CheckoutTokens & Readonly<{ background: HexColor }>;
}>;

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
  if (background === "white") return white;
  return background === "neutral" ? systemBackground.light : brandBackground;
}

function darkBackground(background: CheckoutBackground, brandBackground: HexColor): HexColor {
  return background === "brand_tint" ? brandBackground : systemBackground.dark;
}

export function checkoutPalette(brandColor: CheckoutBrandColor, background: CheckoutBackground): CheckoutPalette {
  const { light, dark } = checkoutBrandColorCatalog[brandColor];
  return {
    light: { ...light, background: lightBackground(background, light["brand-background"]) },
    dark: { ...dark, background: darkBackground(background, dark["brand-background"]) },
  };
}
