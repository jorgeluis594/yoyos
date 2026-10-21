import { parseSiteConfig, type SiteConfig } from "@landing/src/config/site-config";

function resolveSiteConfig(): SiteConfig {
  const result = parseSiteConfig(import.meta.env);
  if (!result.success) {
    console.error(JSON.stringify({ event: "invalid_site_config", code: result.error.code, variables: result.error.variables }));
    throw new Error(result.error.message);
  }
  return result.data;
}

/** The validated build configuration; pages never read import.meta.env directly. */
export const siteConfig = resolveSiteConfig();
