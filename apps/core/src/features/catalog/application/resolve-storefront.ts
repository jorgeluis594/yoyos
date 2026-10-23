import { ok } from "@shared/functional";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import type { CatalogStore } from "@core/src/features/catalog/application/browse-catalog";
import type { CatalogSettingsDependencies, CatalogSettingsError, StoredCatalogSettings } from "@core/src/features/catalog/application/catalog-settings";
import type { StoreHost } from "@core/src/features/catalog/domain/store-host";

export type Storefront =
  | Readonly<{ kind: "published"; companyId: CompanyId; subdomain: CatalogSubdomain; store: CatalogStore }>
  | Readonly<{ kind: "unavailable" }>;
const unavailable: Storefront = { kind: "unavailable" };

/** One answer covers an unknown name, a released one, a reserved one nobody owns, a malformed host and a hidden catalog, so it never reveals whether a company exists. */
export async function resolveStorefront(input: Readonly<{ host: StoreHost }>, deps: Pick<CatalogSettingsDependencies, "resolveSubdomain">):
  Promise<Result<Storefront, CatalogSettingsError>> {
  if (input.host.kind !== "store") return ok(unavailable);
  const subdomain = input.host.subdomain;
  const owner = await deps.resolveSubdomain(subdomain);
  if (!owner.success) return owner;
  if (!owner.data?.published) return ok(unavailable);
  return ok({ kind: "published", companyId: owner.data.companyId, subdomain, store: owner.data.store });
}

export type LegacyCatalogLink = Readonly<{ kind: "redirect"; subdomain: CatalogSubdomain }> | Readonly<{ kind: "unavailable" }>;

/** The product is not checked: a product of another company redirects too, and the brand host answers «Este producto ya no está disponible». */
export async function resolveLegacyCatalogLink(input: Readonly<{ companyId: CompanyId }>,
  deps: Readonly<{ readCatalogSettings: (companyId: CompanyId) => Promise<Result<StoredCatalogSettings | null, CatalogSettingsError>> }>):
  Promise<Result<LegacyCatalogLink, CatalogSettingsError>> {
  const stored = await deps.readCatalogSettings(input.companyId);
  if (!stored.success) return stored;
  return ok(stored.data?.published && stored.data.subdomain ? { kind: "redirect", subdomain: stored.data.subdomain } : { kind: "unavailable" });
}
