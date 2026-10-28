import type { CompanyId } from "@shared/identity";
import type { ProductId } from "@core/src/features/products/domain/product";

export type ProductPhotosAdded = Readonly<{ companyId: CompanyId; productId: ProductId }>;

declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents { product_photos_added: ProductPhotosAdded }
}
