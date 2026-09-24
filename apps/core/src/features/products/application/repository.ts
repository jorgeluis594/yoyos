import type { Result } from "@shared/result";
import type { CreateError } from "@core/src/features/products/application/create";
import type { CompanyId, Product, ProductId } from "@core/src/features/products/domain/product";

export type ProductRepository = Readonly<{
  create(companyId: CompanyId, product: Product): Promise<Result<ProductId, CreateError>>;
  get(companyId: CompanyId, id: ProductId): Promise<Product | null>;
}>;
