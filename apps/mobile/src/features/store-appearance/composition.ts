import { request } from "@mobile/composition/auth";
import { createStoreAppearanceOperations } from "@mobile/features/store-appearance/application/store-appearance";
import { createLogoFiles } from "@mobile/features/store-appearance/infrastructure/logo-upload";
import { createStoreAppearanceApi } from "@mobile/features/store-appearance/infrastructure/store-appearance-api";

const logoFiles = createLogoFiles(request);
export const storeAppearance = { ...createStoreAppearanceOperations({ api: createStoreAppearanceApi(request), logo: logoFiles }), pickLogo: logoFiles.pick };
