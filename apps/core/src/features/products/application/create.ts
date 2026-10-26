import { err, ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { validateCreate, type RawVariant } from "@core/src/features/products/domain/rules";
import type { RawOption } from "@core/src/features/products/domain/product-structure";
import type { ProductBusinessError, ValidationError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ImageId, Product, ProductId, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import type { ImageLookupError } from "@core/src/shared/images/application/images";
import type { EventBusError } from "@core/src/shared/events/application/contracts";

export type CreateVariantInput = RawVariant;
export type CreateInput = Readonly<{
  id?: ProductId;
  name: string;
  description?: string | null;
  imageId?: ImageId | null;
  currency: Currency;
  options: readonly RawOption[];
  variants: readonly [CreateVariantInput, ...CreateVariantInput[]];
}>;
export type CreateError = Extract<ProductBusinessError, { code: "VALIDATION_ERROR" | "PRODUCT_ID_CONFLICT" | "DUPLICATE_SKU" | "DUPLICATE_COMBINATION" | "ID_CONFLICT" | "IMAGE_NOT_FOUND" }>
  | ProductReadError
  | ImageLookupError;
/** What the composition logs after the commit or on a rejection. Never names, SKUs or prices. */
export type CreateObserver = Readonly<{
  created?: (summary: Readonly<{ productId: ProductId; optionCount: number; variantCount: number }>) => void;
  rejected?: (summary: Readonly<{ productId: ProductId; error: CreateError }>) => void;
}>;
export type CreateDependencies = Readonly<{
  transaction: <T>(companyId: ProductAccess["companyId"], work: () => Promise<Result<T, CreateError>>) => Promise<Result<T, CreateError>>;
  productExists: (id: ProductId) => Promise<Result<boolean, ProductReadError>>;
  findImage: (imageId: ImageId) => Promise<Result<boolean, ImageLookupError>>;
  /** Normalized (trimmed, lowercase) SKUs that other variants of the company already use. */
  findSkuOwners: (normalizedSkus: readonly string[]) => Promise<Result<ReadonlyMap<string, VariantId>, ProductReadError>>;
  /** Option and value ids that already exist in the database. */
  findForeignOptionIds: (ids: readonly string[]) => Promise<Result<ReadonlySet<string>, ProductReadError>>;
  /** Bulk insert of the whole aggregate; translates constraint violations into typed errors. */
  insertProduct: (product: Product) => Promise<Result<ProductId, CreateError>>;
  newId: () => string;
  clock: () => Date;
  observe?: CreateObserver;
  /** Failures are logged by the adapter and recovered by products:index-images; the product stays saved. */
  publishProductImageChanged: (productId: ProductId) => Promise<Result<void, EventBusError>>;
}>;

const normalizeSku = (sku: string) => sku.trim().toLowerCase();

/** Direct callers may pass malformed rows; the validation reports them, so the lookups skip them. */
function skuOf(variant: unknown): string | undefined {
  const sku = typeof variant === "object" && variant !== null && "sku" in variant ? variant.sku : undefined;
  return typeof sku === "string" && sku.trim() ? normalizeSku(sku) : undefined;
}

async function takenSkus(input: CreateInput, deps: CreateDependencies): Promise<Result<readonly ValidationIssue[], ProductReadError>> {
  const variants: readonly unknown[] = Array.isArray(input.variants) ? input.variants : [];
  const normalized = [...new Set(variants.flatMap((variant) => skuOf(variant) ?? []))];
  if (!normalized.length) return ok([]);
  const owners = await deps.findSkuOwners(normalized);
  if (!owners.success) return owners;
  return ok(variants.flatMap((variant, index): ValidationIssue[] => {
    const sku = skuOf(variant);
    return sku !== undefined && owners.data.has(sku)
      ? [{ scope: "newVariant", index, field: "sku", reason: "DUPLICATE_SKU", message: "SKU is already used" }] : [];
  }));
}

async function foreignIds(input: CreateInput, deps: CreateDependencies): Promise<Result<readonly ValidationIssue[], ProductReadError>> {
  const options: readonly RawOption[] = (Array.isArray(input.options) ? input.options : []).filter((option) => Array.isArray(option?.values));
  const ids = [...new Set(options.flatMap((option) => [option.id, ...option.values.map((value) => value.id)]))];
  if (!ids.length) return ok([]);
  const existing = await deps.findForeignOptionIds(ids);
  if (!existing.success) return existing;
  return ok(options.flatMap((option, optionIndex): ValidationIssue[] => [
    ...existing.data.has(option.id) ? [{ scope: "option" as const, optionIndex, optionId: option.id, field: "id" as const, reason: "ID_CONFLICT" as const, message: "Identifier is already used" }] : [],
    ...option.values.flatMap((value, valueIndex): ValidationIssue[] => existing.data.has(value.id)
      ? [{ scope: "value", optionIndex, valueIndex, valueId: value.id, field: "id", reason: "ID_CONFLICT", message: "Identifier is already used" }] : []),
  ]));
}

async function createInTransaction(input: CreateInput, deps: CreateDependencies): Promise<Result<ProductId, CreateError>> {
  const id = input.id ?? deps.newId() as ProductId;
  if (input.id !== undefined) {
    const existing = await deps.productExists(input.id);
    if (!existing.success) return existing;
    if (existing.data) return err({ code: "PRODUCT_ID_CONFLICT", message: "Product ID is already used" });
  }
  const validated = validateCreate(input);
  const skus = await takenSkus(input, deps);
  if (!skus.success) return skus;
  const ids = await foreignIds(input, deps);
  if (!ids.success) return ids;
  const issues = [...validated.issues, ...skus.data, ...ids.data];
  if (issues.length || !validated.value) return err({ code: "VALIDATION_ERROR", message: "Invalid product", issues: issues as unknown as ValidationError["issues"] });
  const value = validated.value;
  if (input.imageId != null) {
    const image = await deps.findImage(input.imageId);
    if (!image.success) return image;
    if (!image.data) return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  }
  const now = deps.clock();
  const variants = value.variants.map((variant): ProductVariant => {
    const variantId = deps.newId() as VariantId;
    return {
      id: variantId, productId: id, combination: variant.combination,
      ...(variant.sku === undefined ? {} : { sku: variant.sku }),
      salePrice: { amount: variant.salePrice, currency: value.currency },
      ...(variant.purchasePrice === undefined ? {} : { purchasePrice: { amount: variant.purchasePrice, currency: value.currency } }),
      qrCode: deps.newId(), status: "active", stock: { variantId, quantity: variant.initialStock },
    };
  }) as [ProductVariant, ...ProductVariant[]];
  const product: Product = {
    id, name: value.name,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(input.imageId == null ? {} : { imageId: input.imageId }),
    currency: value.currency, qrCode: deps.newId(), status: "active",
    createdAt: new Date(now), updatedAt: new Date(now), structureVersion: 1, options: value.options, variants,
  };
  const inserted = await deps.insertProduct(product);
  if (inserted.success) deps.observe?.created?.({ productId: id, optionCount: product.options.length, variantCount: variants.length });
  return inserted;
}

export async function createProduct(input: CreateInput, access: ProductAccess, deps: CreateDependencies): Promise<Result<ProductId, CreateError>> {
  const created = await deps.transaction(access.companyId, () => createInTransaction(input, deps));
  if (!created.success) {
    deps.observe?.rejected?.({ productId: input.id as ProductId, error: created.error });
    return created;
  }
  if (input.imageId != null) await deps.publishProductImageChanged(created.data);
  return created;
}

