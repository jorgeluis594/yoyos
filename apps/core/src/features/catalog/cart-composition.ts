import { ok } from "@shared/functional";
import { orders, type CompanyId } from "@core/src/features/orders";
import { findSellableVariants } from "@core/src/features/products";
import { resolvePublicImage } from "@core/src/shared/images";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { continueToCheckout, type ContinueToCheckoutInput } from "@core/src/features/catalog/application/continue-to-checkout";
import { readPublished } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";
import type { VariantId } from "@core/src/features/products/domain/product";

/** What the cart shows for a variant: never SKU, cost or the exact stock. Missing variants are no longer available. */
export type CartVariant = Readonly<{ variantId: string; productId: string; productName: string; attributes: Readonly<Record<string, string>>;
  price: Readonly<{ amount: number; currency: string }>; maxQuantity: number; imageUrl: string | null }>;

async function refreshCart(companyId: CompanyId, variantIds: readonly VariantId[]) {
  return withTenantIsolation(companyId, async () => {
    const published = await readPublished(companyId);
    if (!published.success) return published;
    if (!published.data) return ok(null);
    const found = await findSellableVariants(variantIds);
    if (!found.success) return found;
    const images = new Map<string, string | null>();
    for (const imageId of new Set(found.data.flatMap((variant) => variant.imageId ? [variant.imageId] : []))) {
      const resolved = await resolvePublicImage(imageId);
      // A photo is decorative in the cart: an unreadable one falls back to the product initial.
      images.set(imageId, resolved.success ? resolved.data?.url ?? null : null);
    }
    return ok(found.data.map((variant): CartVariant => ({ variantId: variant.variantId, productId: variant.productId, productName: variant.productName,
      attributes: variant.variantAttributes, price: variant.unitPrice, maxQuantity: variant.available,
      imageUrl: variant.imageId ? images.get(variant.imageId) ?? null : null })));
  });
}

export const catalogCart = {
  /** `null` when the catalog is not published or the company does not exist. */
  refresh: refreshCart,
  continueToCheckout: (input: ContinueToCheckoutInput, companyId: CompanyId) =>
    withTenantIsolation(companyId, () => continueToCheckout(input, { companyId }, { readPublished, createCatalogOrder: orders.createCatalogOrder })),
  checkoutUrl: orders.checkoutUrl,
};
