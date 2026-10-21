import { useId, type ReactNode } from "react";
import { checkoutThemes, defaultCheckoutTheme } from "@core/src/features/checkout-appearance/domain/checkout-themes";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { checkoutThemeCss } from "@core/src/features/checkout-appearance/presentation/checkout-theme-style";
import "@core/src/features/checkout-appearance/presentation/checkout-theme-fonts.css";
import "@core/src/features/checkout-appearance/presentation/checkout-theme.css";

type CheckoutThemeProps = Readonly<{ appearance: Pick<PublicCheckoutAppearance, "theme"> | null; children: ReactNode }>;

/**
 * Paints the checkout subtree with one fixed theme; a company without appearance gets Clásico.
 * The mode is fixed by the theme: only Noche adds `.dark`, so `dark:` variants of shared components match inside it alone.
 */
export function CheckoutTheme({ appearance, children }: CheckoutThemeProps) {
  // Scoped per instance so two themes on one page never paint each other's subtree.
  const scope = useId();
  const id = appearance?.theme ?? defaultCheckoutTheme;
  const dark = checkoutThemes[id].mode === "dark";
  return <>
    <style dangerouslySetInnerHTML={{ __html: checkoutThemeCss(id, scope) }} />
    <div data-checkout-theme={scope} data-checkout-theme-id={id} className={dark ? "dark min-h-screen" : "min-h-screen"}>{children}</div>
  </>;
}
