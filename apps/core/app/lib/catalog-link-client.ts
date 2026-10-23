import { z } from "zod";
import {
  catalogSettingsErrorSchema, catalogSettingsSchema, subdomainAvailabilitySchema,
  type CatalogSettingsErrorResponse, type CatalogSettingsResponse, type SubdomainAvailabilityResponse,
} from "@shared/contracts/catalog";

/** Initial value, adjustable. */
export const linkRequestTimeoutMs = 15_000;

/**
 * `not_sent`: the browser knew it was offline, so nothing left. `no_response`: the request may have reached core
 * (rejection, timeout, a 5xx or a body that fails the schema). `answered`: a validated answer, including 409, 422 and 429.
 */
export type LinkAnswer<T> =
  | Readonly<{ kind: "answered"; ok: true; body: T }>
  | Readonly<{ kind: "answered"; ok: false; status: number; error: CatalogSettingsErrorResponse }>
  | Readonly<{ kind: "not_sent" }>
  | Readonly<{ kind: "no_response" }>;

const notSent = { kind: "not_sent" } as const;
const noResponse = { kind: "no_response" } as const;

/**
 * A plain fetch, never a router loader, action, fetcher or revalidation: a network failure cannot reach the editor's
 * error boundary, replace the card or clear the draft. The session cookie authenticates it, as for `/api/images`.
 */
async function send<T>(path: string, schema: z.ZodType<T>, init: RequestInit, signal?: AbortSignal): Promise<LinkAnswer<T>> {
  if (navigator.onLine === false) return notSent;
  const timeout = AbortSignal.timeout(linkRequestTimeoutMs);
  try {
    const response = await fetch(path, { ...init, credentials: "same-origin", headers: { Accept: "application/json", ...init.headers }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (response.status >= 500) return noResponse;
    const body: unknown = await response.json();
    if (response.ok) {
      const parsed = schema.safeParse(body);
      return parsed.success ? { kind: "answered", ok: true, body: parsed.data } : noResponse;
    }
    const error = catalogSettingsErrorSchema.safeParse(body);
    return error.success ? { kind: "answered", ok: false, status: response.status, error: error.data } : noResponse;
  } catch {
    return noResponse;
  }
}

/** Aborting only stops the browser's wait: a request already sent still counts against the per-user limit. */
export function checkSubdomainAvailability(value: string, signal: AbortSignal): Promise<LinkAnswer<SubdomainAvailabilityResponse>> {
  return send(`/api/catalog/subdomain-availability?${new URLSearchParams({ value })}`, subdomainAvailabilitySchema, {}, signal);
}

export function saveCatalogSubdomain(subdomain: string): Promise<LinkAnswer<CatalogSettingsResponse>> {
  return send("/api/catalog/subdomain", catalogSettingsSchema, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subdomain }) });
}

/** The in-doubt re-read: the save is idempotent, so reading is the safe way to find out what happened. */
export function readCatalogSettings(): Promise<LinkAnswer<CatalogSettingsResponse>> {
  return send("/api/catalog/settings", catalogSettingsSchema, {});
}
