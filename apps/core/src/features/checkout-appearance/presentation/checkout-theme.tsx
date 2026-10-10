import type { ReactNode } from "react";
import { checkoutPalette, type CheckoutPalette } from "@core/src/features/checkout-appearance/domain/checkout-colors";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";

type CheckoutThemeProps = Readonly<{ appearance: PublicCheckoutAppearance | null; children: ReactNode }>;

const declarations = (tokens: CheckoutPalette["light"]) =>
  Object.entries(tokens).map(([name, value]) => `--${name}:${value};`).join("");

/** Values come only from the code catalog, never from seller data, so the CSS cannot carry user text. */
export function checkoutThemeCss({ brandColor, background }: Pick<PublicCheckoutAppearance, "brandColor" | "background">): string {
  const palette = checkoutPalette(brandColor, background);
  return `[data-checkout-theme]{${declarations(palette.light)}}.dark [data-checkout-theme]{${declarations(palette.dark)}}`;
}

export function CheckoutTheme({ appearance, children }: CheckoutThemeProps) {
  return <>
    {appearance && <style dangerouslySetInnerHTML={{ __html: checkoutThemeCss(appearance) }} />}
    <div data-checkout-theme="" className="min-h-screen bg-background text-foreground">{children}</div>
  </>;
}
