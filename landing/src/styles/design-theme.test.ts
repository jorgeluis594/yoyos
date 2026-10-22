import { describe, expect, test } from "vitest";
import tokens from "@docs/design-tokens.json";
import { themeCss } from "@landing/src/styles/design-theme";

describe("themeCss", () => {
  test("emits only colors.light and declares the light color scheme", () => {
    expect(themeCss).toContain("color-scheme:light;");
    expect(themeCss).toContain(`--background:${tokens.colors.light.background};`);
    expect(themeCss).not.toContain("prefers-color-scheme");
    expect(themeCss).not.toContain(tokens.colors.dark.background);
  });

  test("exposes the landing typography, spacing and pill radius tokens", () => {
    expect(themeCss).toContain("--text-display-size:2.5rem;");
    expect(themeCss).toContain("--text-headline-wide-line:3rem;");
    expect(themeCss).toContain("--space-24:6rem;");
    expect(themeCss).toContain("--radius-pill:624.9375rem;");
    expect(themeCss).toContain("--landing-max-width:75rem;");
  });

  test("exposes the landing motion durations and distances", () => {
    expect(themeCss).toContain(`--motion-feedback:${tokens.motion.feedbackMs}ms;`);
    expect(themeCss).toContain("--motion-entrance:480ms;");
    expect(themeCss).toContain("--motion-rise:1rem;");
    expect(themeCss).toContain("--motion-reveal-rise:2rem;");
    expect(themeCss).toContain("--motion-reveal-slide:3rem;");
    expect(themeCss).toContain("--motion-lift:0.125rem;");
  });
});
