import { ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type CompanyId = string & { readonly __brand: "CompanyId" };
export type UserId = string & { readonly __brand: "UserId" };
export type CatalogSettingsAccess = Readonly<{ companyId: CompanyId; userId: UserId }>;
export type CatalogSettings = Readonly<{ published: boolean }>;
export type CatalogSettingsError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type CatalogSettingsDependencies = Readonly<{
  readPublished: (companyId: CompanyId) => Promise<Result<boolean, CatalogSettingsError>>;
  savePublished: (companyId: CompanyId, published: boolean) => Promise<Result<null, CatalogSettingsError>>;
}>;

export async function getCatalogSettings(access: CatalogSettingsAccess, deps: Pick<CatalogSettingsDependencies, "readPublished">): Promise<Result<CatalogSettings, CatalogSettingsError>> {
  const published = await deps.readPublished(access.companyId);
  return published.success ? ok({ published: published.data }) : published;
}

export async function setCatalogPublication(input: Readonly<{ published: boolean }>, access: CatalogSettingsAccess,
  deps: CatalogSettingsDependencies): Promise<Result<CatalogSettings, CatalogSettingsError>> {
  const saved = await deps.savePublished(access.companyId, input.published);
  return saved.success ? getCatalogSettings(access, deps) : saved;
}
