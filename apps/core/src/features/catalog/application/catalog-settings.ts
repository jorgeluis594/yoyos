import { err, ok } from "@shared/functional";
import { isReservedCatalogSubdomain, parseCatalogSubdomain, suggestCatalogSubdomain, type CatalogSubdomain, type SubdomainFormatReason } from "@shared/catalog-subdomain";
import type { Result } from "@shared/result";
import type { CatalogStore } from "@core/src/features/catalog/application/browse-catalog";

export type CompanyId = string & { readonly __brand: "CompanyId" };
export type UserId = string & { readonly __brand: "UserId" };
export type CatalogSettingsAccess = Readonly<{ companyId: CompanyId; userId: UserId }>;
export type CatalogSettings = Readonly<{ published: boolean; subdomain: CatalogSubdomain | null; suggestion: CatalogSubdomain | null }>;
export type StoredCatalogSettings = Readonly<{ published: boolean; subdomain: CatalogSubdomain | null; companyName: string }>;
export type SubdomainOwner = Readonly<{ companyId: CompanyId; published: boolean; store: CatalogStore }>;
export type SubdomainAvailability =
  | Readonly<{ status: "available" | "current" | "in_use"; subdomain: CatalogSubdomain }>
  | Readonly<{ status: "reserved" }>
  | Readonly<{ status: "invalid"; reason: SubdomainFormatReason }>;
export type SubdomainChange = "unchanged" | "first" | "replaced";

export type CatalogSettingsError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type SaveSubdomainError = CatalogSettingsError | Readonly<{ code: "SUBDOMAIN_TAKEN"; message: string }>;
export type SaveCatalogSubdomainError = SaveSubdomainError
  | Readonly<{ code: "INVALID_SUBDOMAIN"; reason: SubdomainFormatReason; message: string }>
  | Readonly<{ code: "SUBDOMAIN_RESERVED"; message: string }>;
export type SetCatalogPublicationError = CatalogSettingsError | Readonly<{ code: "SUBDOMAIN_REQUIRED"; message: string }>;

export type CatalogSettingsDependencies = Readonly<{
  readCatalogSettings: (companyId: CompanyId) => Promise<Result<StoredCatalogSettings, CatalogSettingsError>>;
  /** Across companies: the owner of a subdomain, or ok(null) when nobody holds it. */
  resolveSubdomain: (subdomain: CatalogSubdomain) => Promise<Result<SubdomainOwner | null, CatalogSettingsError>>;
  /** The unique index decides a race: a taken value fails with SUBDOMAIN_TAKEN and assigns nothing. */
  saveSubdomain: (companyId: CompanyId, subdomain: CatalogSubdomain) => Promise<Result<null, SaveSubdomainError>>;
  /** Publishing is conditional on a saved subdomain; hiding never is. */
  savePublication: (companyId: CompanyId, published: boolean) => Promise<Result<"saved" | "subdomain_missing", CatalogSettingsError>>;
}>;

const withoutSuggestion = (stored: StoredCatalogSettings): CatalogSettings => ({ published: stored.published, subdomain: stored.subdomain, suggestion: null });

/** The suggestion is dropped, never an error, when its lookup fails: the adapter already logged it. */
async function availableSuggestion(companyName: string, deps: Pick<CatalogSettingsDependencies, "resolveSubdomain">): Promise<CatalogSubdomain | null> {
  const suggestion = suggestCatalogSubdomain(companyName);
  if (!suggestion || isReservedCatalogSubdomain(suggestion)) return null;
  const owner = await deps.resolveSubdomain(suggestion);
  return owner.success && owner.data === null ? suggestion : null;
}

export async function getCatalogSettings(access: CatalogSettingsAccess,
  deps: Pick<CatalogSettingsDependencies, "readCatalogSettings" | "resolveSubdomain">): Promise<Result<CatalogSettings, CatalogSettingsError>> {
  const stored = await deps.readCatalogSettings(access.companyId);
  if (!stored.success) return stored;
  if (stored.data.subdomain) return ok(withoutSuggestion(stored.data));
  return ok({ published: stored.data.published, subdomain: null, suggestion: await availableSuggestion(stored.data.companyName, deps) });
}

export async function checkSubdomainAvailability(input: Readonly<{ value: string }>, access: CatalogSettingsAccess,
  deps: Pick<CatalogSettingsDependencies, "resolveSubdomain">): Promise<Result<SubdomainAvailability, CatalogSettingsError>> {
  const parsed = parseCatalogSubdomain(input.value.toLowerCase());
  if (!parsed.success) return ok({ status: "invalid", reason: parsed.error.reason });
  const owner = await deps.resolveSubdomain(parsed.data);
  if (!owner.success) return owner;
  // Before the reserved check, so a name added to the list later never takes away a saved subdomain.
  if (owner.data?.companyId === access.companyId) return ok({ status: "current", subdomain: parsed.data });
  if (isReservedCatalogSubdomain(parsed.data)) return ok({ status: "reserved" });
  return ok({ status: owner.data ? "in_use" : "available", subdomain: parsed.data });
}

export async function saveCatalogSubdomain(input: Readonly<{ subdomain: string }>, access: CatalogSettingsAccess,
  deps: Pick<CatalogSettingsDependencies, "readCatalogSettings" | "saveSubdomain">):
  Promise<Result<Readonly<{ settings: CatalogSettings; change: SubdomainChange }>, SaveCatalogSubdomainError>> {
  const parsed = parseCatalogSubdomain(input.subdomain);
  if (!parsed.success) return err({ code: "INVALID_SUBDOMAIN", reason: parsed.error.reason, message: parsed.error.message });
  const stored = await deps.readCatalogSettings(access.companyId);
  if (!stored.success) return stored;
  // A retry after a lost response is safe, and a company keeps a subdomain that became reserved.
  if (stored.data.subdomain === parsed.data) return ok({ settings: withoutSuggestion(stored.data), change: "unchanged" });
  if (isReservedCatalogSubdomain(parsed.data)) return err({ code: "SUBDOMAIN_RESERVED", message: "Subdomain is reserved" });
  const saved = await deps.saveSubdomain(access.companyId, parsed.data);
  if (!saved.success) return saved;
  return ok({ settings: withoutSuggestion({ ...stored.data, subdomain: parsed.data }), change: stored.data.subdomain ? "replaced" : "first" });
}

export async function setCatalogPublication(input: Readonly<{ published: boolean }>, access: CatalogSettingsAccess,
  deps: Pick<CatalogSettingsDependencies, "readCatalogSettings" | "savePublication">): Promise<Result<CatalogSettings, SetCatalogPublicationError>> {
  const saved = await deps.savePublication(access.companyId, input.published);
  if (!saved.success) return saved;
  if (saved.data === "subdomain_missing") return err({ code: "SUBDOMAIN_REQUIRED", message: "A subdomain is required to publish the catalog" });
  const stored = await deps.readCatalogSettings(access.companyId);
  return stored.success ? ok(withoutSuggestion(stored.data)) : stored;
}
