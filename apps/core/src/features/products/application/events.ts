import type { CompanyId } from "@shared/identity";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

export type ProductPhotosAdded = Readonly<{ companyId: CompanyId; productId: ProductId }>;

/** Stock went up for these variants (at least one); published inside the transaction that increased it. */
export type ProductStockIncreased = Readonly<{ companyId: CompanyId; variantIds: readonly [VariantId, ...VariantId[]] }>;

declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents { product_photos_added: ProductPhotosAdded }
}
