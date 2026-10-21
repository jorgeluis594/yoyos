import { describe, expect, test } from "vitest";
import tokens from "@docs/design-tokens.json";
import { buildManifest } from "@landing/src/lib/manifest";

describe("buildManifest", () => {
  test("builds the manifest with the token background color and the 192 and 512 icons", () => {
    const manifest = buildManifest(tokens);
    expect(manifest).toMatchObject({
      name: "Yoyos",
      short_name: "Yoyos",
      lang: "es-PE",
      start_url: "/",
      display: "browser",
      background_color: tokens.colors.light.background,
      theme_color: tokens.colors.light.background,
    });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
  });
});
