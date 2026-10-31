import { err, ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { validateCreate, type RawVariant } from "@core/src/features/products/domain/rules";
import { parseProductPhotos } from "@core/src/features/products/domain/photos";
import type { RawOption } from "@core/src/features/products/domain/product-structure";
import type { ProductBusinessError, ValidationError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ImageId, Product, ProductId, ProductPhotos, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import type { ImageLookupError } from "@core/src/shared/images/application/images";
import type { EventBusError } from "@core/src/shared/events/application/contracts";

export type CreateVariantInput = RawVariant;
export type CreateInput = Readonly<{
  id?: ProductId;
  name: string;
  description?: string | null;
  /** Ordered, position 0 is the primary; omitted = no photos (the HTTP contract requires the list). */
  photoIds?: readonly ImageId[];
  /** The seller hides the product from buyers; omitted = visible (the HTTP contract requires it). */
  hidden?: boolean;
  currency: Currency;
  options: readonly RawOption[];
  variants: readonly [CreateVariantInput, ...CreateVariantInput[]];
}>;
export type CreateError = Extract<ProductBusinessError, { code: "VALIDATION_ERROR" | "PRODUCT_ID_CONFLICT" | "DUPLICATE_SKU" | "DUPLICATE_COMBINATION" | "ID_CONFLICT" }>
  | ProductReadError
  | ImageLookupError;
/** What the composition logs after the commit or on a rejection. Never names, SKUs or prices. */
export type CreateObserver = Readonly<{
  created?: (summary: Readonly<{ productId: ProductId; optionCount: number; variantCount: number; photoCount: number; hidden: boolean }>) => void;
  rejected?: (summary: Readonly<{ productId: ProductId; error: CreateError }>) => void;
}>;
export type CreateDependencies = Readonly<{
  transaction: <T>(companyId: ProductAccess["companyId"], work: () => Promise<Result<T, CreateError>>) => Promise<Result<T, CreateError>>;
  productExists: (id: ProductId) => Promise<Result<boolean, ProductReadError>>;
  /** The ids that exist for the company (RLS). */
  findImages: (ids: readonly ImageId[]) => Promise<Result<ReadonlySet<ImageId>, ImageLookupError>>;
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
  publishProductPhotosAdded: (productId: ProductId) => Promise<Result<void, EventBusError>>;
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

/** Photo issues: the parse (limit, repeats) and, for a list that parses, every id the company does not have. */
async function photoIssues(input: CreateInput, deps: CreateDependencies): Promise<Result<Readonly<{ photos: ProductPhotos | null; issues: readonly ValidationIssue[] }>, ImageLookupError>> {
  const parsed = parseProductPhotos(Array.isArray(input.photoIds) ? input.photoIds : []);
  if (!parsed.success) return ok({ photos: null, issues: parsed.error.issues });
  if (!parsed.data.length) return ok({ photos: parsed.data, issues: [] });
  const found = await deps.findImages(parsed.data);
  if (!found.success) return found;
  const issues = parsed.data.flatMap((id, index): ValidationIssue[] => found.data.has(id)
    ? [] : [{ scope: "photo", field: "photoIds", index, reason: "PHOTO_NOT_FOUND", message: "Photo is unavailable" }]);
  return ok({ photos: parsed.data, issues });
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
  const photos = await photoIssues(input, deps);
  if (!photos.success) return photos;
  const issues = [...validated.issues, ...photos.data.issues, ...skus.data, ...ids.data];
  if (issues.length || !validated.value || !photos.data.photos) return err({ code: "VALIDATION_ERROR", message: "Invalid product", issues: issues as unknown as ValidationError["issues"] });
  const value = validated.value;
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
    photoIds: photos.data.photos,
    currency: value.currency, qrCode: deps.newId(), status: "active",
    hidden: input.hidden ?? false, createdAt: new Date(now), updatedAt: new Date(now), structureVersion: 1, options: value.options, variants,
  };
  const inserted = await deps.insertProduct(product);
  if (inserted.success) deps.observe?.created?.({ productId: id, optionCount: product.options.length, variantCount: variants.length, photoCount: product.photoIds.length, hidden: product.hidden });
  return inserted;
}

export async function createProduct(input: CreateInput, access: ProductAccess, deps: CreateDependencies): Promise<Result<ProductId, CreateError>> {
  const created = await deps.transaction(access.companyId, () => createInTransaction(input, deps));
  if (!created.success) {
    deps.observe?.rejected?.({ productId: input.id as ProductId, error: created.error });
    return created;
  }
  if (input.photoIds?.length) await deps.publishProductPhotosAdded(created.data);
  return created;
}

