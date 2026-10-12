import { randomUUID } from "node:crypto";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import {
  parseCompanyId, parseImageId, type CheckoutBackground, type CheckoutBrandColor,
} from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { persistCheckoutAppearance } from "@core/src/features/checkout-appearance/infrastructure/checkout-appearance-repository";

type StoredAppearance = Readonly<{ brandColor: CheckoutBrandColor; background: CheckoutBackground; withLogo: boolean }>;

/** Saves the appearance of one company the way the editor will, without going through the UI. */
export async function saveCompanyAppearance(companyId: string, { brandColor, background, withLogo }: StoredAppearance) {
  const company = parseCompanyId(companyId);
  if (!company.success) throw new Error("Invalid company id for the appearance fixture");
  const imageId = withLogo ? randomUUID() : null;
  const logo = imageId ? parseImageId(imageId) : null;
  if (logo && !logo.success) throw new Error("Invalid image id for the appearance fixture");
  await withTenantIsolation(company.data, async () => {
    if (imageId) await prisma.image.create({ data: { id: imageId, storageKey: `logos/${imageId}.png` } });
    const saved = await persistCheckoutAppearance(company.data, { logoImageId: logo?.success ? logo.data : null, brandColor, background });
    if (!saved.success) throw new Error("Appearance fixture failed");
  });
}

export async function removeCompanyAppearance(companyId: string) {
  await withTenantIsolation(companyId, async () => {
    await prisma.companyCheckoutAppearance.deleteMany();
    await prisma.image.deleteMany();
  });
}
