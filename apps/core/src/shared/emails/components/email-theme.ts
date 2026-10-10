import { designTokens } from "@core/app/design-theme";

const { light, dark } = designTokens.colors;

// Email clients ignore CSS variables, so templates inline light values and a <style> block remaps them where dark mode is supported.
export const emailColors = {
  canvas: light.background,
  card: light.card,
  text: light.foreground,
  muted: light["muted-foreground"],
  border: light.border,
  brand: light.primary,
  action: light.primary,
  actionText: light["primary-foreground"],
  link: light["accent-foreground"],
} as const;

export const emailFont = `${designTokens.typography.family}, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
export const emailRadius = designTokens.radius;

export const emailDarkCss = `@media (prefers-color-scheme: dark) {
  .email-canvas { background-color: ${dark.background} !important; }
  .email-card { background-color: ${dark.card} !important; border-color: ${dark.border} !important; }
  .email-divider { border-color: ${dark.border} !important; }
  .email-text { color: ${dark.foreground} !important; }
  .email-muted { color: ${dark["muted-foreground"]} !important; }
  .email-brand { color: ${dark.primary} !important; }
  .email-action { background-color: ${dark.primary} !important; color: ${dark["primary-foreground"]} !important; }
  .email-link { color: ${dark["accent-foreground"]} !important; }
}`;
