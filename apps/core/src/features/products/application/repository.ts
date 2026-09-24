import type { Result } from "@shared/result";
import type { CreateError } from "./create";
import type { CompanyId, Product, ProductId } from "../domain/product";

export type ProductRepository = Readonly<{
  create(companyId: CompanyId, product: Product): Promise<Result<ProductId, CreateError>>;
  get(companyId: CompanyId, id: ProductId): Promise<Product | null>;
}>;
