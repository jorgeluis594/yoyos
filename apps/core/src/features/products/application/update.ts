import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { planUpdate, validateUpdate, type RawUpdate } from "@core/src/features/products/domain/rules";
import type { ValidationError } from "@core/src/features/products/domain/errors";
import type { CompanyId, ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductReadError, ProductRepository, UpdateChanges } from "@core/src/features/products/application/repository";
import type { ImageLookupError } from "@core/src/shared/images/application/images";

export type UpdateVariantInput = Readonly<{ id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type UpdateInput = Readonly<{ name?: string; description?: string | null; imageId?: ImageId | null; variants?: readonly UpdateVariantInput[] }>;
export type UpdateError = ValidationError
  | Readonly<{ code: "DUPLICATE_SKU"; message: string }>
  | Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }>
  | Readonly<{ code: "PRODUCT_NOT_FOUND"; message: string }>
  | ProductReadError
  | ImageLookupError;
export type UpdateDependencies = Readonly<{
  repository: Pick<ProductRepository, "get" | "update">;
  findImage: (companyId: CompanyId, imageId: ImageId) => Promise<Result<boolean, ImageLookupError>>;
  clock: () => Date;
}>;

export async function updateProduct(companyId: CompanyId, productId: ProductId, input: UpdateInput, deps: UpdateDependencies): Promise<Result<ProductId, UpdateError>> {
  const loaded = await deps.repository.get(companyId, productId);
  if (!loaded.success) return loaded;
  const current = loaded.data;
  if (!current) return err({ code: "PRODUCT_NOT_FOUND", message: "Product does not exist" });
  const validated = validateUpdate(current, input as RawUpdate);
  if (!validated.value) return err({ code: "VALIDATION_ERROR", message: "Invalid product", issues: validated.issues as ValidationError["issues"] });
  const imageId = validated.value.imageId;
  if (typeof imageId === "string") {
    const image = await deps.findImage(companyId, imageId);
    if (!image.success) return image;
    if (!image.data) return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  }
  const plan = planUpdate(current, validated.value);
  if (!plan) return ok(productId);
  const updatedAt = deps.clock();
  const money = (amount: number): Money => ({ amount, currency: current.currency });
  const changes: UpdateChanges = {
    product: { ...plan.product, updatedAt },
    variants: plan.variants.map((variant) => ({
      id: variant.id,
      ...(variant.sku === undefined ? {} : { sku: variant.sku }),
      ...(variant.salePrice === undefined ? {} : { salePrice: money(variant.salePrice) }),
      ...(variant.purchasePrice === undefined ? {} : { purchasePrice: variant.purchasePrice === null ? null : money(variant.purchasePrice) }),
    })),
  };
  return deps.repository.update(companyId, productId, changes);
}
