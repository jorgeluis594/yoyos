import type { CSSProperties } from "react";
import { checkoutThemes, type CheckoutColorToken, type CheckoutThemeId } from "@core/src/features/checkout-appearance/domain/checkout-themes";

/** Style values refer to these color variables, so the sample defines them itself instead of reading the page's. */
const sampleColors: readonly CheckoutColorToken[] = ["border", "foreground", "control", "input", "selected", "card", "muted-foreground", "primary", "thumbnail-surface"];

/** A static miniature painted with a theme's own values: page, card, thumbnail shape and main button. */
export function ThemeSample({ theme }: Readonly<{ theme: CheckoutThemeId }>) {
  const { colors, style, thumbnail, backgroundImage } = checkoutThemes[theme];
  const frame = {
    backgroundColor: colors.background,
    ...(backgroundImage ? { backgroundImage: backgroundImage.css } : {}),
    ...Object.fromEntries(sampleColors.map((token) => [`--${token}`, colors[token]])),
  } as CSSProperties;
  const card: CSSProperties = {
    backgroundColor: colors.card, border: style["card-border"], borderTop: style["card-border-top"],
    borderRadius: `min(${style["radius-card"]}, 0.75rem)`, boxShadow: style["card-shadow"],
  };
  const photo: CSSProperties = {
    width: "1.25rem", aspectRatio: thumbnail.ratio, backgroundColor: colors["thumbnail-surface"], border: thumbnail.border,
    borderRadius: `min(${thumbnail.radius}, 0.5rem)`,
  };
  const button: CSSProperties = {
    height: "0.875rem", backgroundColor: colors.primary, border: style["button-border"], borderRadius: `min(${style["radius-button"]}, 0.5rem)`,
    boxShadow: style["button-shadow"],
  };
  return <span aria-hidden="true" data-slot="theme-sample" style={frame} className="block h-16 w-24 shrink-0 overflow-hidden rounded-md border p-2">
    <span style={card} className="flex size-full flex-col justify-between p-1.5">
      <span className="flex items-center gap-1.5">
        <span style={photo} className="block shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span style={{ backgroundColor: colors.foreground }} className="block h-1 w-full rounded-full" />
          <span style={{ backgroundColor: colors["muted-foreground"] }} className="block h-0.5 w-2/3 rounded-full" />
        </span>
      </span>
      <span style={button} className="block" />
    </span>
  </span>;
}
