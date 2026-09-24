import { err } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { validateCreate, type RawVariant } from "../domain/rules";
import type { ValidationError } from "../domain/errors";
import type { CompanyId, ImageId, Product, ProductId, ProductVariant, VariantId } from "../domain/product";
import type { ProductRepository } from "./repository";

export type CreateVariantInput = RawVariant;
export type CreateInput = Readonly<{
  name: string;
  description?: string;
  imageId?: ImageId;
  currency: Currency;
  variants: readonly [CreateVariantInput, ...CreateVariantInput[]];
}>;
export type CreateError = ValidationError
  | Readonly<{ code: "DUPLICATE_SKU"; message: string }>
  | Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }>;
export type CreateDependencies = Readonly<{
  repository: ProductRepository;
  findImage: (companyId: CompanyId, imageId: ImageId) => Promise<boolean>;
  newId: () => string;
  clock: () => Date;
}>;

export async function createProduct(companyId: CompanyId, input: CreateInput, deps: CreateDependencies): Promise<Result<ProductId, CreateError>> {
  const validated = validateCreate(input);
  if (!validated.value) return err({ code: "VALIDATION_ERROR", message: "Invalid product", issues: validated.issues as ValidationError["issues"] });
  if (input.imageId !== undefined && !(await deps.findImage(companyId, input.imageId))) {
    return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  }
  const now = deps.clock();
  const id = deps.newId() as ProductId;
  const variants = validated.value.variants.map((variant): ProductVariant => {
    const variantId = deps.newId() as VariantId;
    return {
      id: variantId, productId: id, attributes: variant.attributes,
      ...(variant.sku === undefined ? {} : { sku: variant.sku }),
      salePrice: { amount: variant.salePrice, currency: validated.value!.currency },
      ...(variant.purchasePrice === undefined ? {} : { purchasePrice: { amount: variant.purchasePrice, currency: validated.value!.currency } }),
      qrCode: deps.newId(), status: "active", stock: { variantId, quantity: variant.initialStock },
    };
  }) as [ProductVariant, ...ProductVariant[]];
  const product: Product = {
    id, companyId, name: validated.value.name,
    ...(validated.value.description === undefined ? {} : { description: validated.value.description }),
    ...(input.imageId === undefined ? {} : { imageId: input.imageId }),
    currency: validated.value.currency, qrCode: deps.newId(), status: "active",
    createdAt: new Date(now), updatedAt: new Date(now), variants,
  };
  return deps.repository.create(companyId, product);
}
