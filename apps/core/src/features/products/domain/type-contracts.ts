import type { CreateError, CreateInput } from "@core/src/features/products/application/create";
import type { DetailError } from "@core/src/features/products/application/get";
import type { CompanyId, ImageId, Product, ProductId, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import type { ProductValidationReason } from "@core/src/features/products/domain/errors";

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type ReadonlyField<T, K extends keyof T> = Equal<Pick<T, K>, Readonly<Pick<T, K>>>;

export type ProductContracts = [
  Assert<Equal<ProductId extends VariantId ? true : false, false>>,
  Assert<Equal<ProductId extends CompanyId ? true : false, false>>,
  Assert<Equal<ImageId extends ProductId ? true : false, false>>,
  Assert<Equal<[] extends Product["variants"] ? true : false, false>>,
  Assert<Equal<[] extends CreateInput["variants"] ? true : false, false>>,
  Assert<ReadonlyField<Product, "name">>,
  Assert<ReadonlyField<Product, "variants">>,
  Assert<ReadonlyField<ProductVariant, "stock">>,
  Assert<ReadonlyField<ProductVariant["stock"], "quantity">>,
  Assert<Equal<Extract<CreateError, { code: "PRODUCT_NOT_FOUND" }>, never>>,
  Assert<Equal<Extract<DetailError, { code: "DUPLICATE_SKU" }>, never>>,
  Assert<Equal<Extract<ProductValidationReason, { reason: "TOO_LONG" }>, { readonly reason: "TOO_LONG"; readonly maxLength: number }>>,
];
