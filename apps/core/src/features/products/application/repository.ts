import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { CreateError } from "@core/src/features/products/application/create";
import type { ListOutput } from "@core/src/features/products/application/list";
import type { UpdateError } from "@core/src/features/products/application/update";
import type { CompanyId, ImageId, Product, ProductId, VariantId } from "@core/src/features/products/domain/product";

export type Criteria = Readonly<{ search?: string; page: number; pageSize: number }>;
export type ProductChanges = Readonly<{ name?: string; description?: string | null; imageId?: ImageId | null; updatedAt: Date }>;
export type VariantChanges = Readonly<{ id: VariantId; sku?: string | null; salePrice?: Money; purchasePrice?: Money | null }>;
export type UpdateChanges = Readonly<{ product: ProductChanges; variants: readonly VariantChanges[] }>;
export type ProductRepository = Readonly<{
  create(companyId: CompanyId, product: Product): Promise<Result<ProductId, CreateError>>;
  update(companyId: CompanyId, id: ProductId, changes: UpdateChanges): Promise<Result<ProductId, UpdateError>>;
  get(companyId: CompanyId, id: ProductId): Promise<Product | null>;
  list(companyId: CompanyId, criteria: Criteria): Promise<ListOutput>;
}>;
