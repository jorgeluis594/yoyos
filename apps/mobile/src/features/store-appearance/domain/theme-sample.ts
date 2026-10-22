import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { StoreThemeDefinition } from "@shared/store-themes";

export type ThemeSample = Readonly<{
  background: string;
  /** Stops of the page gradient (Suave), or null for a flat background. */
  gradient: readonly string[] | null;
  card: string;
  border: string;
  borderWidth: number;
  primary: string;
  primaryForeground: string;
  buttonRadius: number;
  cardRadius: number;
  /** width / height of the thumbnail. */
  thumbnailAspect: number;
  thumbnailRadius: number;
}>;
export type ThemeSampleError = Readonly<{ code: "UNSUPPORTED_UNIT"; message: string }>;

const unsupported = (value: string): ThemeSampleError => ({ code: "UNSUPPORTED_UNIT", message: `Theme value "${value}" is not in px` });

/** Only `0` and `<n>px` are sampled; any other unit would render wrong, so it fails instead. */
function px(value: string): Result<number, ThemeSampleError> {
  const match = /^(?:0|(\d+(?:\.\d+)?)px)$/.exec(value.trim());
  return match ? ok(Number(match[1] ?? 0)) : err(unsupported(value));
}

function borderWidth(value: string): Result<number, ThemeSampleError> {
  const trimmed = value.trim();
  return trimmed === "none" ? ok(0) : px(trimmed.split(/\s+/)[0] ?? trimmed);
}

/** Numeric styles of a theme's static sample. Fonts are never mapped: the sample uses the system font. */
export function themeSample(theme: StoreThemeDefinition): Result<ThemeSample, ThemeSampleError> {
  const buttonRadius = px(theme.style["radius-button"]);
  if (!buttonRadius.success) return buttonRadius;
  const cardRadius = px(theme.style["radius-card"]);
  if (!cardRadius.success) return cardRadius;
  const width = borderWidth(theme.style["card-border"]);
  if (!width.success) return width;
  const thumbnailRadius = px(theme.thumbnail.radius);
  if (!thumbnailRadius.success) return thumbnailRadius;
  return ok({
    background: theme.colors.background,
    gradient: theme.backgroundImage?.stops ?? null,
    card: theme.colors.card,
    border: theme.colors.border,
    borderWidth: width.data,
    primary: theme.colors.primary,
    primaryForeground: theme.colors["primary-foreground"],
    buttonRadius: buttonRadius.data,
    cardRadius: cardRadius.data,
    thumbnailAspect: theme.thumbnail.ratio === "4 / 5" ? 4 / 5 : 1,
    thumbnailRadius: thumbnailRadius.data,
  });
}
