import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { parseSiteConfig } from "./src/config/site-config";

const mode = process.argv.includes("dev") ? "development" : "production";
// Process variables win over .env files, so the build-output suite can pass explicit values.
const result = parseSiteConfig({ ...loadEnv(mode, process.cwd(), "PUBLIC_"), ...process.env });
if (!result.success) {
  console.error(JSON.stringify({ event: "invalid_site_config", code: result.error.code, variables: result.error.variables }));
  throw new Error(result.error.message);
}

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  site: result.data.siteUrl,
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "always" },
  integrations: [sitemap({ filter: (page) => !page.endsWith("/404") })],
  vite: {
    resolve: {
      alias: { "@docs": path("../docs"), "@landing": path("."), "@shared": path("../shared") },
    },
    server: { fs: { allow: [path(".."), path("../docs"), path("../shared")] } },
  },
});
