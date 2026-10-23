import * as Network from "expo-network";
import {
  catalogSettingsErrorSchema, catalogSettingsSchema, subdomainAvailabilitySchema, subdomainErrorReason,
  type CatalogSettingsErrorResponse, type CatalogSettingsResponse, type SubdomainAvailabilityResponse,
} from "@shared/contracts/catalog";
import type { SubdomainFormatReason } from "@shared/catalog-subdomain";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

/** `not_sent` never left the phone; `no_response` may or may not have been applied; `answered` is a definite answer from core. */
export type CatalogLinkError =
  | Readonly<{ kind: "not_sent" }>
  | Readonly<{ kind: "no_response" }>
  | Readonly<{ kind: "answered"; code: CatalogSettingsErrorResponse["code"]; reason: SubdomainFormatReason | null }>;

/** Like `Result`, but the error is the kind of answer the card decides on, not a message. */
export type LinkResult<T> = Readonly<{ success: true; data: T }> | Readonly<{ success: false; error: CatalogLinkError }>;
const linkFailure = (error: CatalogLinkError): LinkResult<never> => ({ success: false, error });

function response(raw: Result<unknown, TransportError>): Result<CatalogSettingsResponse, TransportError> {
  if (!raw.success) return raw;
  const parsed = catalogSettingsSchema.safeParse(raw.data);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid catalog settings response" });
}

function errorBody(error: TransportError): CatalogSettingsErrorResponse | null {
  const parsed = catalogSettingsErrorSchema.safeParse(error.http?.body);
  return parsed.success ? parsed.data : null;
}

/** True when core answered that the catalog cannot be published without a saved subdomain. */
export function subdomainRequired(error: TransportError): boolean {
  return errorBody(error)?.code === "SUBDOMAIN_REQUIRED";
}

/** Anything that is not a definite answer re-reads: that is the safe default, because a save is idempotent. */
function linkError(error: TransportError): CatalogLinkError {
  const body = errorBody(error);
  if (body === null || body.code === "SERVICE_UNAVAILABLE" || body.code === "INTERNAL_ERROR") return { kind: "no_response" };
  return { kind: "answered", code: body.code, reason: subdomainErrorReason(body) };
}

async function notConnected(): Promise<boolean> {
  try { return (await Network.getNetworkStateAsync()).isConnected === false; }
  catch { return false; }
}

export function createCatalogSettingsApi(request: Request) {
  return {
    get: async () => response(await request("/api/catalog/settings")),
    setPublished: async (published: boolean) => response(await request("/api/catalog/settings", { method: "PUT",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ published }) })),
    checkSubdomain: async (value: string, signal?: AbortSignal): Promise<LinkResult<SubdomainAvailabilityResponse>> => {
      const raw = await request(`/api/catalog/subdomain-availability?value=${encodeURIComponent(value)}`, { signal });
      if (!raw.success) return linkFailure(linkError(raw.error));
      const parsed = subdomainAvailabilitySchema.safeParse(raw.data);
      return parsed.success ? ok(parsed.data) : linkFailure({ kind: "no_response" });
    },
    saveSubdomain: async (subdomain: string): Promise<LinkResult<CatalogSettingsResponse>> => {
      if (await notConnected()) return linkFailure({ kind: "not_sent" });
      const result = response(await request("/api/catalog/subdomain", { method: "PUT",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ subdomain }) }));
      return result.success ? result : linkFailure(linkError(result.error));
    },
  };
}
