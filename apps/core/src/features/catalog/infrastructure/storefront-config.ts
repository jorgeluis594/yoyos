import { isIP } from "node:net";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { Result } from "@shared/result";
import type { HostConfig } from "@core/src/features/catalog/domain/store-host";

export type StorefrontConfig = Readonly<{ baseUrl: URL; host: HostConfig }>;
export type StorefrontConfigError = Readonly<{ code: "INVALID_CONFIG"; message: string }>;
type StorefrontEnv = Readonly<{ CATALOG_BASE_URL?: string; BETTER_AUTH_URL?: string; NODE_ENV?: string }>;

const developmentUrl = "http://localhost:3000";
const invalid = (message: string) => err({ code: "INVALID_CONFIG" as const, message });
const isIpHost = (hostname: string) => hostname.startsWith("[") || isIP(hostname) !== 0;

function parseBaseUrl(value: string, production: boolean): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  const schemeAllowed = url.protocol === "https:" || (!production && url.protocol === "http:");
  const plain = url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
  return schemeAllowed && plain && !isIpHost(url.hostname) ? url : null;
}

export function parseStorefrontConfig(env: StorefrontEnv): Result<StorefrontConfig, StorefrontConfigError> {
  const production = env.NODE_ENV === "production";
  const value = env.CATALOG_BASE_URL === undefined || env.CATALOG_BASE_URL === "" ? (production ? undefined : developmentUrl) : env.CATALOG_BASE_URL;
  if (value === undefined) return invalid("CATALOG_BASE_URL is required in production");
  const base = parseBaseUrl(value, production);
  if (!base) return invalid(`CATALOG_BASE_URL must be ${production ? "an https" : "an http or https"} URL with a domain name, no path, query or hash`);
  const app = z.url().safeParse(env.BETTER_AUTH_URL ?? developmentUrl);
  if (!app.success) return invalid("BETTER_AUTH_URL must be a URL");
  return ok({ baseUrl: base, host: { baseHostname: base.hostname, appHostname: new URL(app.data).hostname } });
}

/** `https://fantasio.yoyos.lat/` or `http://fantasio.localhost:3000/` for the config's base URL. */
export const storeUrlFor = (config: StorefrontConfig, subdomain: CatalogSubdomain, path = "/"): URL =>
  new URL(`${config.baseUrl.protocol}//${subdomain}.${config.baseUrl.host}${path}`);
/** The part the subdomain goes under, e.g. "yoyos.lat" or "localhost:3000". */
export const storeDomainFor = (config: StorefrontConfig): string => config.baseUrl.host;

const parsedConfig = parseStorefrontConfig(process.env);
if (!parsedConfig.success) throw new Error(parsedConfig.error.message);
/** Parsed once at import, so a misconfigured web process fails at startup. */
export const storefrontConfig: StorefrontConfig = parsedConfig.data;
export const storeUrl = (subdomain: CatalogSubdomain, path?: string): URL => storeUrlFor(storefrontConfig, subdomain, path);
export const storeDomain = (): string => storeDomainFor(storefrontConfig);
