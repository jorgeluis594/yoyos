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
};

/** Static, class-less theme: always light (founder decision: the landing has no dark mode). */
export const themeCss = `:root{color-scheme:light;${cssVariables({ ...tokens.colors.light, ...typographyVariables, ...geometryVariables })}}`;

export const designTokens = tokens;
