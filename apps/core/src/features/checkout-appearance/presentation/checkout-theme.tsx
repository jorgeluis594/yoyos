import { useId, type ReactNode } from "react";
import { checkoutPalette, type CheckoutPalette } from "@core/src/features/checkout-appearance/domain/checkout-colors";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";

type CheckoutThemeProps = Readonly<{ appearance: PublicCheckoutAppearance | null; children: ReactNode }>;

const declarations = (tokens: CheckoutPalette["light"]) =>
  Object.entries(tokens).map(([name, value]) => `--${name}:${value};`).join("");

/**
 * Values come only from the code catalog, never from seller data, so the CSS cannot carry user text.
 * `scope` comes from React's `useId` (no quotes or backslashes), so it is safe inside the attribute selector.
 */
export function checkoutThemeCss(
  { brandColor, background }: Pick<PublicCheckoutAppearance, "brandColor" | "background">, scope: string,
): string {
  const palette = checkoutPalette(brandColor, background);
  const selector = `[data-checkout-theme="${scope}"]`;
  return `${selector}{${declarations(palette.light)}}.dark ${selector}{${declarations(palette.dark)}}`;
}

export function CheckoutTheme({ appearance, children }: CheckoutThemeProps) {
  // Scoped per instance so two themes on one page never paint each other's subtree.
  const scope = useId();
  return <>
    {appearance && <style dangerouslySetInnerHTML={{ __html: checkoutThemeCss(appearance, scope) }} />}
    <div data-checkout-theme={scope} className="min-h-screen bg-background text-foreground">{children}</div>
  </>;
}
