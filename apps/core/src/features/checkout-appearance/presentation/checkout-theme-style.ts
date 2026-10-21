import {
  checkoutColorTokens, checkoutStyleTokens, checkoutThemes, type CheckoutFontFamily, type CheckoutThemeDefinition, type CheckoutThemeId,
} from "@core/src/features/checkout-appearance/domain/checkout-themes";

const systemSans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** The self-hosted families register as "<Name> Variable" (Fontsource); the rest of each stack is the fallback while a font loads. */
export const checkoutFontStacks: Readonly<Record<CheckoutFontFamily, string>> = {
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

function variables(theme: CheckoutThemeDefinition): Declaration[] {
  const { fonts, logo, thumbnail } = theme;
  return [
    ...checkoutColorTokens.map((token): Declaration => [`--${token}`, theme.colors[token]]),
    ...checkoutStyleTokens.map((token): Declaration => [`--checkout-${token}`, theme.style[token]]),
    ["--checkout-font-body", checkoutFontStacks[fonts.body]],
    ["--checkout-font-heading", checkoutFontStacks[fonts.heading]],
    ["--checkout-font-product-name", checkoutFontStacks[fonts.productName]],
    ["--checkout-font-button", checkoutFontStacks[fonts.button]],
    ["--checkout-logo-direction", logo.direction],
    ["--checkout-logo-text-align", logo.placement === "center" ? "center" : "left"],
    ["--checkout-logo-height", logo.height], ["--checkout-logo-radius", logo.radius], ["--checkout-logo-border", logo.border],
    ["--checkout-logo-shadow", logo.shadow], ["--checkout-logo-padding", logo.padding],
    ["--checkout-thumb-width", thumbnail.width], ["--checkout-thumb-ratio", thumbnail.ratio], ["--checkout-thumb-radius", thumbnail.radius],
    ["--checkout-thumb-border", thumbnail.border], ["--checkout-thumb-filter", thumbnail.filter],
  ];
}

/** The root of the checkout paints the page and sets the base text from the variables above. */
function root(theme: CheckoutThemeDefinition): Declaration[] {
  return [
    ["color-scheme", theme.mode],
    ["color", "var(--foreground)"],
    ["background-color", "var(--background)"],
    ...(theme.backgroundImage ? [["background-image", theme.backgroundImage.css] as const] : []),
    ["font-family", "var(--checkout-font-body)"],
    ["font-size", "var(--checkout-text-body)"],
    ["font-weight", "var(--checkout-weight-body)"],
    ["line-height", "1.4"],
  ];
}

/**
 * Values come only from the code catalog, never from seller data, so the CSS cannot carry user text.
 * `scope` comes from React's `useId` (no quotes or backslashes), so it is safe inside the attribute selector.
 * The second rule paints the page behind the checkout (overscroll on a phone) and only matches a page that contains it.
 */
export function checkoutThemeCss(id: CheckoutThemeId, scope: string): string {
  const theme = checkoutThemes[id];
  const selector = `[data-checkout-theme="${scope}"]`;
  return block(selector, [...variables(theme), ...root(theme)])
    + block(`html:has(${selector})`, [["background", theme.colors.background]]);
}
