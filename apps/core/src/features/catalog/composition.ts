import { log } from "@core/src/shared/infrastructure/logger";
import { getCatalogSettings, setCatalogPublication, type CatalogSettingsAccess } from "@core/src/features/catalog/application/catalog-settings";
import { readPublished, savePublished } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";

export const catalogSettings = {
  get: (access: CatalogSettingsAccess) => getCatalogSettings(access, { readPublished }),
  setPublication: async (published: boolean, access: CatalogSettingsAccess) => {
    const result = await setCatalogPublication({ published }, access, { readPublished, savePublished });
    if (result.success) log.info({ event: "catalog_publication_changed", companyId: access.companyId, userId: access.userId,
      published: result.data.published }, "catalog_publication_changed");
    return result;
  },
};
