import tokens from "@docs/design-tokens.json";

const cssVariables = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([name, value]) => `--${name}:${value};`)
    .join("");
const rem = (value: number) => `${value / 16}rem`;

const typographyVariables = Object.fromEntries(
  Object.entries(tokens.typography.roles).flatMap(([role, { size, lineHeight, weight }]) => [
    [`text-${role}-size`, rem(size)],
    [`text-${role}-line`, rem(lineHeight)],
    [`text-${role}-weight`, String(weight)],
  ]),
);

/** Landing-only motion (DESIGN.md "Landing"): a button lifts by half the smallest spacing step on hover, and the hero
   plays one opening sequence that ends on the WhatsApp button (founder request, 2026-11-27). Nothing else on the page
   animates on load or scroll. `motion-beat` is the unit the sequence's delays are counted in. */
const landingMotionVariables = {
  "motion-lift": rem(tokens.spacing[1] / 2),
  "motion-arrive": "cubic-bezier(0.16, 1, 0.3, 1)",
  "motion-scene": "700ms",
  "motion-stamp": "320ms",
  "motion-pickup": "320ms",
  "motion-beat": "150ms",
  "motion-nudge-cycle": "6s",
};

/** Landing-only "packing table" world (DESIGN.md "Landing"): kraft paper under the hero and its first section, paper
   strips and sheets laid on it, packing tape and the ink of a rubber stamp. Fluid sizes live here so no component
   writes a size literal. */
const landingWorldVariables = {
  "kraft-ink": "#2b1a0f",
  "kraft-ink-soft": "#3f2a1a",
  "kraft-shade": "#c59b6a",
  "kraft-tile-size": "32rem",
  "kraft-wash": "rgb(252 240 218 / 0.3)",
  "hero-lead-measure": "36rem",
  paper: "#faf5ec",
  "paper-line": "rgb(43 26 15 / 0.18)",
  tape: "rgb(244 226 188 / 0.5)",
  "tape-solid": "rgb(226 200 150 / 0.85)",
  "tape-opaque": "#e3cba0",
  whatsapp: "#14853a",
  "whatsapp-hover": "#0f6f2f",
  "stamp-ink": "#b3261e",
  "showcase-ink": "#faf5ec",
  showcase: "#21110a",
  "showcase-glow": "rgb(214 120 44 / 0.85)",
  "showcase-soft": "#f1e4d2",
  "shadow-showcase": "0 1.75rem 2.5rem rgb(0 0 0 / 0.55)",
  "shadow-paper": "0 0.125rem 0.375rem rgb(43 26 15 / 0.24)",
  "shadow-object": "0 1.25rem 1.5rem rgb(43 26 15 / 0.38)",
  "font-display": '"Akt", "Inter Variable", "Inter Fallback", system-ui, sans-serif',
  "tracking-display": "-0.02em",
  "hero-max-width": "92rem",
  "hero-min-height": "min(100svh - 4rem, 50rem)",
  "hero-scene-max-width": "calc((min(100svh, 54rem) - 14rem) * 1.1)",
  "hero-title-size": "clamp(2.125rem, 0.9rem + 3.9vw, 4.75rem)",
  "hero-title-size-phone": "clamp(2rem, 0.25rem + 9.3vw, 3.5rem)",
  "hero-lead-size": "clamp(1rem, 0.9rem + 0.45vw, 1.25rem)",
  "hero-price-size": "clamp(2.25rem, 1.7rem + 1.9vw, 3.5rem)",
  "sheet-title-size": "clamp(1.625rem, 1.2rem + 1.9vw, 2.75rem)",
  "sheet-radius": "1.5rem",
  "stamp-border": "0.1875rem",
};

const geometryVariables = {
  ...Object.fromEntries(Object.entries(tokens.spacing).map(([step, value]) => [`space-${step}`, rem(value)])),
  ...Object.fromEntries(Object.entries(tokens.radius).map(([role, value]) => [`radius-${role}`, rem(value)])),
  "landing-max-width": rem(tokens.layout.landingMaxWidth),
  "reader-max-width": rem(tokens.layout.readerMaxWidth),
  "form-max-width": rem(tokens.layout.formMaxWidth),
  "page-gutter-mobile": rem(tokens.layout.pageGutterMobile),
  "page-gutter-desktop": rem(tokens.layout.pageGutterDesktop),
  "header-min-height": rem(tokens.layout.appHeaderMinHeight),
  "control-min-height": rem(tokens.sizing.controlDesktopMinHeight),
  "touch-target-min-size": rem(tokens.sizing.touchTargetMinSize),
  "icon-inline-size": rem(tokens.sizing.iconInline),
  "icon-action-size": rem(tokens.sizing.iconAction),
  "icon-navigation-size": rem(tokens.sizing.iconNavigation),
  "icon-stroke": String(tokens.sizing.iconStroke),
  "border-width": `${tokens.sizing.borderWidth}px`,
  "focus-width": `${tokens.sizing.focusWidth}px`,
  "focus-offset": `${tokens.sizing.focusOffset}px`,
  "motion-feedback": `${tokens.motion.feedbackMs}ms`,
  "motion-easing": tokens.motion.easing,
  ...landingMotionVariables,
  ...landingWorldVariables,
};

/** Static, class-less theme: always light (founder decision: the landing has no dark mode). */
export const themeCss = `:root{color-scheme:light;${cssVariables({ ...tokens.colors.light, ...typographyVariables, ...geometryVariables })}}`;

export const designTokens = tokens;
