import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import {
  checkSubdomainAvailability, getCatalogSettings, saveCatalogSubdomain, setCatalogPublication,
  type CatalogSettingsAccess, type CatalogSettingsDependencies, type CompanyId, type CatalogSettingsError, type StoredCatalogSettings,
} from "@core/src/features/catalog/application/catalog-settings";
import { resolveBrandHostOwner, resolveLegacyCatalogLink, resolveStorefront } from "@core/src/features/catalog/application/resolve-storefront";
import type { StoreHost } from "@core/src/features/catalog/domain/store-host";
import { readCatalogSettings, readStorefrontState, resolveSubdomain, savePublication, saveSubdomain } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";
import type { StorefrontState } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

/** A seller's own company always exists; the legacy link resolver reads the absent case from the repository itself. */
async function readStoredSettings(companyId: Parameters<CatalogSettingsDependencies["readCatalogSettings"]>[0]): Promise<Result<StoredCatalogSettings, CatalogSettingsError>> {
  const stored = await readCatalogSettings(companyId);
  if (!stored.success) return stored;
  return stored.data ? ok(stored.data) : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Company not found" });
}

const dependencies: CatalogSettingsDependencies = { readCatalogSettings: readStoredSettings, resolveSubdomain, saveSubdomain, savePublication };

export const catalogSettings = {
  get: (access: CatalogSettingsAccess) => getCatalogSettings(access, dependencies),
  checkSubdomain: (value: string, access: CatalogSettingsAccess) => checkSubdomainAvailability({ value }, access, dependencies),
  saveSubdomain: async (subdomain: string, access: CatalogSettingsAccess) => {
    const result = await saveCatalogSubdomain({ subdomain }, access, dependencies);
    if (result.success && result.data.change !== "unchanged") log.info({ event: "catalog_subdomain_saved", companyId: access.companyId, userId: access.userId,
      change: result.data.change }, "catalog_subdomain_saved");
    else if (!result.success && (result.error.code === "INVALID_SUBDOMAIN" || result.error.code === "SUBDOMAIN_RESERVED" || result.error.code === "SUBDOMAIN_TAKEN"))
      log.debug({ event: "catalog_subdomain_rejected", companyId: access.companyId, userId: access.userId, errorCode: result.error.code,
        ...(result.error.code === "INVALID_SUBDOMAIN" ? { reason: result.error.reason } : {}) }, "catalog_subdomain_rejected");
    return result;
  },
  setPublication: async (published: boolean, access: CatalogSettingsAccess) => {
    const result = await setCatalogPublication({ published }, access, dependencies);
    if (result.success) log.info({ event: "catalog_publication_changed", companyId: access.companyId, userId: access.userId,
      published: result.data.published }, "catalog_publication_changed");
    else if (result.error.code === "SUBDOMAIN_REQUIRED") log.debug({ event: "catalog_publication_rejected", companyId: access.companyId, userId: access.userId,
      errorCode: result.error.code }, "catalog_publication_rejected");
    return result;
  },
};

/** The brand host's store in one round trip; the request keeps the answer, so nothing else reads the store again. */
export const catalogStorefront = {
  resolve: (host: StoreHost) => resolveStorefront({ host }, { resolveSubdomain }),
  /** For the checkout and buyer-API paths: the host's company even when the catalog is hidden. */
  resolveOwner: (host: StoreHost) => resolveBrandHostOwner({ host }, { resolveSubdomain }),
  /** The seller's own storefront for an assistant: joins the caller's snapshot, so it shares the view of the product rows. */
  describe: (companyId: CompanyId): Promise<Result<StorefrontState, CatalogSettingsError>> => readStorefrontState(companyId),
};

export const catalogLegacy = {
  /** Under RLS an unknown company reads as absent, the same as a hidden catalog. */
  resolve: (companyId: CompanyId) => resolveLegacyCatalogLink({ companyId }, { readCatalogSettings: (id) => withTenantIsolation(id, () => readCatalogSettings(id)) }),
};
