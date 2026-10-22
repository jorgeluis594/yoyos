import {
  storeColorTokens, storeStyleTokens, storeThemes, type StoreFontFamily, type StoreThemeDefinition, type StoreThemeId,
} from "@shared/store-themes";

const systemSans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** The self-hosted families register as "<Name> Variable" (Fontsource); the rest of each stack is the fallback while a font loads. */
export const storeFontStacks: Readonly<Record<StoreFontFamily, string>> = {
  system: systemSans,
  inter: `"Inter Variable", "Inter", ${systemSans}`,
  "playfair-display": '"Playfair Display Variable", "Playfair Display", Georgia, "Times New Roman", serif',
  fredoka: '"Fredoka Variable", "Fredoka", "Nunito Variable", system-ui, sans-serif',
  nunito: '"Nunito Variable", "Nunito", "Arial Rounded MT Bold", system-ui, sans-serif',
  outfit: '"Outfit Variable", "Outfit", system-ui, sans-serif',
};

type Declaration = readonly [name: string, value: string];
const block = (selector: string, declarations: readonly Declaration[]) =>
  `${selector}{${declarations.map(([name, value]) => `${name}:${value};`).join("")}}`;

function variables(theme: StoreThemeDefinition): Declaration[] {
  const { fonts, logo, thumbnail } = theme;
  return [
    ...storeColorTokens.map((token): Declaration => [`--${token}`, theme.colors[token]]),
    ...storeStyleTokens.map((token): Declaration => [`--store-${token}`, theme.style[token]]),
    ["--store-font-body", storeFontStacks[fonts.body]],
    ["--store-font-heading", storeFontStacks[fonts.heading]],
    ["--store-font-product-name", storeFontStacks[fonts.productName]],
    ["--store-font-button", storeFontStacks[fonts.button]],
    ["--store-logo-direction", logo.direction],
    ["--store-logo-text-align", logo.placement === "center" ? "center" : "left"],
    ["--store-logo-height", logo.height], ["--store-logo-max-width", logo.maxWidth], ["--store-logo-radius", logo.radius], ["--store-logo-border", logo.border],
    ["--store-logo-shadow", logo.shadow], ["--store-logo-padding", logo.padding],
    ["--store-thumb-width", thumbnail.width], ["--store-thumb-ratio", thumbnail.ratio], ["--store-thumb-radius", thumbnail.radius],
    ["--store-thumb-border", thumbnail.border], ["--store-thumb-filter", thumbnail.filter],
  ];
}

/** The root of the checkout paints the page and sets the base text from the variables above. */
function root(theme: StoreThemeDefinition): Declaration[] {
  return [
    ["color-scheme", theme.mode],
    ["color", "var(--foreground)"],
    ["background-color", "var(--background)"],
    ...(theme.backgroundImage ? [["background-image", theme.backgroundImage.css] as const] : []),
    ["font-family", "var(--store-font-body)"],
    ["font-size", "var(--store-text-body)"],
    ["font-weight", "var(--store-weight-body)"],
    ["line-height", "1.4"],
  ];
}

/**
 * Values come only from the code catalog, never from seller data, so the CSS cannot carry user text.
 * `scope` comes from React's `useId` (no quotes or backslashes), so it is safe inside the attribute selector.
 * The second rule paints the page behind the checkout (overscroll on a phone) and only matches a page that contains it.
 */
export function storeThemeCss(id: StoreThemeId, scope: string): string {
  const theme = storeThemes[id];
  const selector = `[data-store-theme="${scope}"]`;
  return block(selector, [...variables(theme), ...root(theme)])
    + block(`html:has(${selector})`, [["background", theme.colors.background]]);
}
