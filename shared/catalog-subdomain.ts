import { err, ok } from "./functional.js";
import type { Result } from "./result.js";

export type CatalogSubdomain = string & { readonly __brand: "CatalogSubdomain" };
/** In priority order; the first that applies is the only reason shown. */
export type SubdomainFormatReason =
  | "contains_domain"
  | "contains_space"
  | "invalid_character"
  | "too_long"
  | "hyphen_edge"
  | "double_hyphen"
  | "too_short";
export type SubdomainFormatError = Readonly<{ reason: SubdomainFormatReason; message: string }>;

export const catalogSubdomainLength = { min: 3, max: 30 } as const;

/** The product list. Code may only add names, and a name added later never takes away a saved subdomain. */
export const reservedCatalogSubdomains: ReadonlySet<string> = new Set([
  "www", "api", "app", "admin", "mail", "smtp", "ftp", "cdn", "static", "assets", "status", "docs", "help", "support", "billing", "pay",
  "checkout", "catalogo", "catalog", "yoyos", "landing", "auth", "login", "signup", "webhook", "webhooks", "dev", "staging", "test",
]);

const failure = (reason: SubdomainFormatReason, message: string) => err({ reason, message });

/** Receives the value already lowercased: the server never lowercases for the client. */
export function parseCatalogSubdomain(value: string): Result<CatalogSubdomain, SubdomainFormatError> {
  if (value.includes(".") || value.includes("://")) return failure("contains_domain", "Write only the name, without a domain");
  if (/\s/.test(value)) return failure("contains_space", "Spaces are not allowed");
  if (/[^a-z0-9-]/.test(value)) return failure("invalid_character", "Use only unaccented lowercase letters, digits and hyphens");
  if (value.length > catalogSubdomainLength.max) return failure("too_long", `Use up to ${catalogSubdomainLength.max} characters`);
  if (value.startsWith("-") || value.endsWith("-")) return failure("hyphen_edge", "It cannot start or end with a hyphen");
  if (value.includes("--")) return failure("double_hyphen", "It cannot contain two hyphens in a row");
  if (value.length < catalogSubdomainLength.min) return failure("too_short", `Use at least ${catalogSubdomainLength.min} characters`);
  return ok(value as CatalogSubdomain);
}

export function isReservedCatalogSubdomain(subdomain: CatalogSubdomain): boolean {
  return reservedCatalogSubdomains.has(subdomain);
}

/** «Café Fantasío» → "cafe-fantasio"; null when the result is shorter than 3. Reserved and availability are checked by the caller. */
export function suggestCatalogSubdomain(companyName: string): CatalogSubdomain | null {
  const converted = companyName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, catalogSubdomainLength.max).replace(/-+$/, "");
  const parsed = parseCatalogSubdomain(converted);
  return parsed.success ? parsed.data : null;
}
