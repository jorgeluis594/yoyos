import { useId, type ReactNode } from "react";
import { storeThemes, defaultStoreTheme } from "@shared/store-themes";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { storeThemeCss } from "@core/src/features/store-appearance/presentation/store-theme-style";
import "@core/src/features/store-appearance/presentation/store-theme-fonts.css";
import "@core/src/features/store-appearance/presentation/store-theme.css";

type StoreThemeProps = Readonly<{ appearance: Pick<PublicStoreAppearance, "theme"> | null; children: ReactNode }>;

/**
 * Paints the checkout subtree with one fixed theme; a company without appearance gets Clásico.
 * The mode is fixed by the theme: only Noche adds `.dark`, so `dark:` variants of shared components match inside it alone.
 */
export function StoreTheme({ appearance, children }: StoreThemeProps) {
  // Scoped per instance so two themes on one page never paint each other's subtree.
  const scope = useId();
  const id = appearance?.theme ?? defaultStoreTheme;
  const dark = storeThemes[id].mode === "dark";
  return <>
    <style dangerouslySetInnerHTML={{ __html: storeThemeCss(id, scope) }} />
    <div data-store-theme={scope} data-store-theme-id={id} className={dark ? "dark min-h-screen" : "min-h-screen"}>{children}</div>
  </>;
}
