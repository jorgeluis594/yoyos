import type { CompanyId } from "@shared/identity";
import type { Currency } from "@shared/money";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { SavedProduct } from "@core/src/features/products/application/save-product";

/** What the notice needs of the seller's storefront; the catalog feature's state satisfies it, so products never imports catalog. */
export type StorefrontReading = Readonly<{ currency: Currency; catalog: Readonly<{ kind: "published" | "hidden" | "hidden_without_link" }> }>;
type DescribeStorefront = (companyId: CompanyId) => Promise<Result<StorefrontReading, Readonly<{ code: string; message: string }>>>;

/** The seller's published catalog just lost its last offered product: the save hid it and the catalog sells in the product's currency. */
export function catalogEmptied(saved: SavedProduct, storefront: Readonly<{ published: boolean; currency: Currency }>): boolean {
  return saved.hidLastOffered && storefront.published && saved.detail.product.currency === storefront.currency;
}

/** The read runs after the save committed: a thrown read is a failed read, never a failed save. */
async function readStorefront(describeStorefront: DescribeStorefront, companyId: CompanyId): ReturnType<DescribeStorefront> {
  try { return await describeStorefront(companyId); }
  catch { return err({ code: "STOREFRONT_READ_THROWN", message: "The storefront read threw" }); }
}

/**
 * The one helper the API route and the web action use: reads the storefront only when the save hid the last offered product,
 * decides with `catalogEmptied` and logs the outcome. The notice informs, it never decides the save, so a failed read means no notice.
 */
export async function resolveCatalogEmptied(saved: SavedProduct, access: Readonly<{ companyId: CompanyId }>, describeStorefront: DescribeStorefront): Promise<boolean> {
  if (!saved.hidLastOffered) return false;
  const { companyId } = access;
  const productId = saved.detail.product.id;
  const storefront = await readStorefront(describeStorefront, companyId);
  if (!storefront.success) {
    log.warn({ event: "product_catalog_emptied_check_failed", companyId, productId, errorCode: storefront.error.code }, "product_catalog_emptied_check_failed");
    return false;
  }
  const emptied = catalogEmptied(saved, { published: storefront.data.catalog.kind === "published", currency: storefront.data.currency });
  if (emptied) log.info({ event: "product_catalog_emptied", companyId, productId }, "product_catalog_emptied");
  return emptied;
}
