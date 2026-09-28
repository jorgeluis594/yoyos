import { err } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { validateCreate, type RawVariant } from "@core/src/features/products/domain/rules";
import type { ValidationError } from "@core/src/features/products/domain/errors";
import type { ImageId, Product, ProductId, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import type { ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";
import type { ImageLookupError } from "@core/src/shared/images/application/images";

export type CreateVariantInput = RawVariant;
export type CreateInput = Readonly<{
  id?: ProductId;
  name: string;
  description?: string;
  imageId?: ImageId;
  currency: Currency;
  variants: readonly [CreateVariantInput, ...CreateVariantInput[]];
}>;
export type CreateError = ValidationError
  | Readonly<{ code: "DUPLICATE_SKU"; message: string }>
  | Readonly<{ code: "PRODUCT_ID_CONFLICT"; message: string }>
  | Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }>
  | ProductReadError
  | ImageLookupError;
export type CreateDependencies = Readonly<{
  repository: Pick<ProductRepository, "create" | "get">;
  findImage: (imageId: ImageId) => Promise<Result<boolean, ImageLookupError>>;
  newId: () => string;
  clock: () => Date;
}>;

export async function createProduct(input: CreateInput, deps: CreateDependencies): Promise<Result<ProductId, CreateError>> {
  if (input.id !== undefined) {
    const existing = await deps.repository.get(input.id);
    if (!existing.success) return err(existing.error);
    if (existing.data) return err({ code: "PRODUCT_ID_CONFLICT", message: "Product ID is already used" });
  }
  const validated = validateCreate(input);
  if (!validated.value) return err({ code: "VALIDATION_ERROR", message: "Invalid product", issues: validated.issues as ValidationError["issues"] });
  if (input.imageId !== undefined) {
    const image = await deps.findImage(input.imageId);
    if (!image.success) return image;
    if (!image.data) return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  }
  const now = deps.clock();
  const id = input.id ?? deps.newId() as ProductId;
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
    id, name: validated.value.name,
    ...(validated.value.description === undefined ? {} : { description: validated.value.description }),
    ...(input.imageId === undefined ? {} : { imageId: input.imageId }),
    currency: validated.value.currency, qrCode: deps.newId(), status: "active",
    createdAt: new Date(now), updatedAt: new Date(now), variants,
  };
  return deps.repository.create(product);
}
