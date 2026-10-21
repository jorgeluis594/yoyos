import { describe, expect, test } from "vitest";
import tokens from "@docs/design-tokens.json";
import { themeCss } from "@landing/src/styles/design-theme";

describe("themeCss", () => {
  test("uses colors.light by default and colors.dark under the dark system preference", () => {
    const [light, dark] = themeCss.split("@media (prefers-color-scheme:dark)");
    expect(light).toContain(`--background:${tokens.colors.light.background};`);
    expect(light).not.toContain(tokens.colors.dark.background);
    expect(dark).toContain(`--background:${tokens.colors.dark.background};`);
    expect(dark).toContain(`--primary:${tokens.colors.dark.primary};`);
  });

  test("exposes the landing typography, spacing and pill radius tokens", () => {
    expect(themeCss).toContain("--text-display-size:2.5rem;");
    expect(themeCss).toContain("--text-headline-wide-line:3rem;");
    expect(themeCss).toContain("--space-24:6rem;");
    expect(themeCss).toContain("--radius-pill:624.9375rem;");
    expect(themeCss).toContain("--landing-max-width:75rem;");
  });
});
