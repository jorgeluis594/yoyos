import type tokens from "@docs/design-tokens.json";

type Tokens = Pick<typeof tokens, "colors">;

export type WebManifest = Readonly<{
  name: string;
  short_name: string;
  lang: string;
  start_url: string;
  display: "browser";
  background_color: string;
  theme_color: string;
  icons: readonly Readonly<{ src: string; sizes: string; type: string }>[];
}>;

export function buildManifest(designTokens: Tokens): WebManifest {
  const { background } = designTokens.colors.light;
  return {
    name: "Yoyos",
    short_name: "Yoyos",
    lang: "es-PE",
    start_url: "/",
    display: "browser",
    background_color: background,
    theme_color: background,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
