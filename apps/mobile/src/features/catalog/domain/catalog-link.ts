import type { CatalogSettingsResponse, SubdomainAvailabilityResponse } from "@shared/contracts/catalog";
import { isReservedCatalogSubdomain, parseCatalogSubdomain, type SubdomainFormatReason } from "@shared/catalog-subdomain";

/** What the screen needs from the catalog settings: the saved link, the publication and the suggestion. */
export type CatalogLink = CatalogSettingsResponse;

/** The latest answer for the typed value. `check_failed` is the client's own verdict for a check that got no usable answer. */
export type LinkVerdict = SubdomainAvailabilityResponse | Readonly<{ status: "check_failed" }>;

export type LinkFieldState =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "typing" }>
  | Readonly<{ kind: "short" }>
  | Readonly<{ kind: "checking"; subdomain: string }>
  | Readonly<{ kind: "invalid"; reason: Exclude<SubdomainFormatReason, "too_short"> }>
  | Readonly<{ kind: "reserved" }>
  | Readonly<{ kind: "in_use"; subdomain: string }>
  | Readonly<{ kind: "available"; subdomain: string }>
  | Readonly<{ kind: "saved"; subdomain: string }>
  | Readonly<{ kind: "current"; subdomain: string }>
  | Readonly<{ kind: "check_failed"; subdomain: string }>;

/** Maps the typed (already lowercase) value, the saved subdomain and the latest verdict to the status line state. `justSaved` tells «Link guardado» from «Es tu link actual». */
export function linkFieldState(value: string, saved: string | null, verdict: LinkVerdict | null, justSaved = false): LinkFieldState {
  if (value === "") return { kind: "empty" };
  const parsed = parseCatalogSubdomain(value);
  if (!parsed.success) return parsed.error.reason === "too_short" ? { kind: "short" } : { kind: "invalid", reason: parsed.error.reason };
  if (value === saved) return { kind: justSaved ? "saved" : "current", subdomain: value };
  if (isReservedCatalogSubdomain(parsed.data)) return { kind: "reserved" };
  if (verdict === null) return { kind: "checking", subdomain: value };
  switch (verdict.status) {
    case "available": return { kind: "available", subdomain: value };
    case "in_use": return { kind: "in_use", subdomain: value };
    case "reserved": return { kind: "reserved" };
    case "current": return { kind: "current", subdomain: value };
    case "check_failed": return { kind: "check_failed", subdomain: value };
    case "invalid": return verdict.reason === "too_short" ? { kind: "short" } : { kind: "invalid", reason: verdict.reason };
  }
}

/** Only a valid, non-reserved value that differs from the saved one is worth asking the server about. */
export function needsServerCheck(value: string, saved: string | null): boolean {
  if (value === saved) return false;
  const parsed = parseCatalogSubdomain(value);
  return parsed.success && !isReservedCatalogSubdomain(parsed.data);
}
