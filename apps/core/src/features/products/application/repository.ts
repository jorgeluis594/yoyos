import type { Money } from "@shared/money";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import type { ListPage, ListSort, StockFilter } from "@core/src/features/products/application/list";
import type { UpdateError } from "@core/src/features/products/application/update";
import type { ProductBusinessError } from "@core/src/features/products/domain/errors";
import type { ImageId, Product, ProductId, VariantId } from "@core/src/features/products/domain/product";

export type Criteria = Readonly<{ search?: string; stock?: StockFilter; sort: ListSort; page: number; pageSize: number }>;
export type ProductReadError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }> | Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
/** Everything a product write can answer, business rejections first. */
export type ProductWriteError = ProductBusinessError | ProductReadError;
/** The tenant the write belongs to, taken from the session. */
export type ProductAccess = Readonly<{ companyId: CompanyId }>;
export type ProductChanges = Readonly<{ name?: string; description?: string | null; imageId?: ImageId | null; updatedAt: Date }>;
export type VariantChanges = Readonly<{ id: VariantId; sku?: string | null; salePrice?: Money; purchasePrice?: Money | null }>;
export type UpdateChanges = Readonly<{ product: ProductChanges; variants: readonly VariantChanges[] }>;
export type ProductRepository = Readonly<{
  update(id: ProductId, changes: UpdateChanges): Promise<Result<ProductId, UpdateError>>;
  get(id: ProductId): Promise<Result<Product | null, ProductReadError>>;
  list(criteria: Criteria): Promise<Result<ListPage, ProductReadError>>;
}>;
