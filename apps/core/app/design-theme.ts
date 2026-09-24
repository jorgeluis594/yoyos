import tokens from "../../../docs/design-tokens.json";

const cssVariables = (values: Record<string, string>) =>
  Object.entries(values).map(([name, value]) => `--${name}:${value};`).join("");
const rem = (value: number) => `${value / 16}rem`;

// One adapter for the application and its component previews.
export const themeCss = `:root{${cssVariables({
  ...tokens.colors.light,
  "radius-control": rem(tokens.radius.control),
  "radius-card": rem(tokens.radius.card),
  "radius-overlay": rem(tokens.radius.overlay),
  "content-max-width": rem(tokens.layout.contentMaxWidth),
  "form-max-width": rem(tokens.layout.formMaxWidth),
  "reader-max-width": rem(tokens.layout.readerMaxWidth),
  "space-unit": rem(tokens.spacing[1]),
  "sidebar-width": rem(tokens.layout.sidebarWidth),
  "navigation-drawer-width": rem(tokens.layout.navigationDrawerWidth),
  "app-header-min-height": rem(tokens.layout.appHeaderMinHeight),
  "page-gutter-mobile": rem(tokens.layout.pageGutterMobile),
  "page-gutter-desktop": rem(tokens.layout.pageGutterDesktop),
  "section-gap": rem(tokens.layout.sectionGap),
  "control-min-height": rem(tokens.sizing.controlDesktopMinHeight),
  "touch-target-min-size": rem(tokens.sizing.touchTargetMinSize),
  "icon-inline-size": rem(tokens.sizing.iconInline),
  "icon-navigation-size": rem(tokens.sizing.iconNavigation),
})}}.dark{${cssVariables(tokens.colors.dark)}}`;
