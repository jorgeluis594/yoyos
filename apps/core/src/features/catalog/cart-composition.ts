import { ok } from "@shared/functional";
import { orders, type CompanyId, type OrderId } from "@core/src/features/orders";
import { findSellableVariants } from "@core/src/features/products";
import { resolvePublicImage } from "@core/src/shared/images";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { continueToCheckout, type ContinueToCheckoutInput } from "@core/src/features/catalog/application/continue-to-checkout";
import { checkCartOrder } from "@core/src/features/catalog/application/check-cart-order";
import type { PublishedStorefront } from "@core/src/features/catalog/application/resolve-storefront";
import type { VariantId } from "@core/src/features/products/domain/product";

/** What the cart shows for a variant: never SKU, cost or the exact stock. Missing variants are no longer available. */
export type CartVariant = Readonly<{ variantId: string; productId: string; productName: string; attributes: Readonly<Record<string, string>>;
  price: Readonly<{ amount: number; currency: string }>; maxQuantity: number; imageUrl: string | null }>;

async function refreshCart(companyId: CompanyId, variantIds: readonly VariantId[]) {
  return withTenantIsolation(companyId, async () => {
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
  /** The caller holds a published storefront; a catalog hidden since is the product's accepted window. */
  refresh: (storefront: PublishedStorefront, variantIds: readonly VariantId[]) => refreshCart(storefront.companyId, variantIds),
  continueToCheckout: (input: ContinueToCheckoutInput, storefront: PublishedStorefront) =>
    withTenantIsolation(storefront.companyId, () => continueToCheckout(input, { companyId: storefront.companyId },
      { readPublished: async () => ok(true), createCatalogOrder: orders.createCatalogOrder })),
  checkOrder: (orderId: OrderId, storefront: PublishedStorefront) =>
    checkCartOrder({ orderId }, { companyId: storefront.companyId }, { readCatalogOrderConfirmation: orders.readCatalogOrderConfirmation }),
  /** A published storefront always has its subdomain, so the link is built without a query and on the host the cart is on. */
  checkoutUrl: (storefront: PublishedStorefront, orderId: OrderId) => orders.checkoutUrlFor(storefront.subdomain, orderId),
};
