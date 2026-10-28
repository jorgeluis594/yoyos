import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isEmptyChange, planProductSave, type ProductStructureChange, type SaveRequest } from "@core/src/features/products/domain/product-structure";
import { parseProductPhotos, samePhotos } from "@core/src/features/products/domain/photos";
import type { ProductBusinessError, ValidationError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ImageId, Product, ProductId, ProductPhotos, VariantId } from "@core/src/features/products/domain/product";
import type { Detail, DetailError } from "@core/src/features/products/application/get";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import type { ImageLookupError } from "@core/src/shared/images/application/images";
import type { EventBusError } from "@core/src/shared/events/application/contracts";

export type SaveProductInput = SaveRequest & Readonly<{ productId: ProductId }>;
export type SaveProductError = Extract<ProductBusinessError, { code: "VALIDATION_ERROR" | "PRODUCT_NOT_FOUND" | "PRODUCT_CHANGED" | "DUPLICATE_SKU" | "DUPLICATE_COMBINATION" | "ID_CONFLICT" | "VARIANT_HAS_ORDERS" }>
  | DetailError
  | ProductReadError
  | ImageLookupError;
/** What the composition logs after the commit or on a rejection. Never names, SKUs or prices. */
export type SaveObserver = Readonly<{
  saved?: (summary: Readonly<{ productId: ProductId; structureVersion: number; optionCount: number; variantCount: number; createdVariants: number; updatedVariants: number;
    deletedVariants: number; rekeyedVariants: number; removedValues: number; photoCount: number; photosChanged: boolean }>) => void;
  rejected?: (summary: Readonly<{ productId: ProductId; error: SaveProductError }>) => void;
}>;
export type SaveProductDependencies = Readonly<{
  transaction: <T>(companyId: ProductAccess["companyId"], work: () => Promise<Result<T, SaveProductError>>) => Promise<Result<T, SaveProductError>>;
  /** `FOR UPDATE` on the Product row, then the aggregate. */
  lockProduct: (id: ProductId) => Promise<Result<Product | null, ProductReadError>>;
  findOrderedVariantIds: (ids: readonly VariantId[]) => Promise<Result<ReadonlySet<VariantId>, ProductReadError>>;
  /** Normalized (trimmed, lowercase) SKUs mapped to the variant that already uses them. */
  findSkuOwners: (normalizedSkus: readonly string[]) => Promise<Result<ReadonlyMap<string, VariantId>, ProductReadError>>;
  /** Option and value ids that already exist in the database. */
  findForeignOptionIds: (ids: readonly string[]) => Promise<Result<ReadonlySet<string>, ProductReadError>>;
  /** The ids that exist for the company (RLS). */
  findImages: (ids: readonly ImageId[]) => Promise<Result<ReadonlySet<ImageId>, ImageLookupError>>;
  /** Bulk writes in the fixed order of the design; translates constraint violations into typed errors. */
  applyStructureChange: (change: ProductStructureChange) => Promise<Result<null, SaveProductError>>;
  /** The editing read, inside the same transaction. */
  reload: (id: ProductId) => Promise<Result<Detail | null, DetailError>>;
  newId: () => string;
  clock: () => Date;
  observe?: SaveObserver;
  /** Failures are logged by the adapter and recovered by products:index-images; the product stays saved. */
  publishProductPhotosAdded: (productId: ProductId) => Promise<Result<void, EventBusError>>;
}>;

const normalizeSku = (sku: string) => sku.trim().toLowerCase();
const skuOf = (sku: string | null | undefined) => typeof sku === "string" && sku.trim() ? normalizeSku(sku) : undefined;

/** SKUs the save sets: new rows and saved rows whose SKU differs from the stored one. A row that keeps its SKU cannot collide. */
async function takenSkus(current: Product, input: SaveProductInput, deps: SaveProductDependencies): Promise<Result<readonly ValidationIssue[], ProductReadError>> {
  const stored = new Map(current.variants.map((variant) => [variant.id as string, skuOf(variant.sku)] as const));
  const deleted = new Set<string>(input.deletedVariantIds);
  const listed = input.variants.filter((variant) => stored.has(variant.id) && !deleted.has(variant.id) && skuOf(variant.sku) !== stored.get(variant.id));
  const rows = [
    ...listed.map((variant) => ({ sku: skuOf(variant.sku), ref: { scope: "variant" as const, variantId: variant.id as string } })),
    ...input.newVariants.map((variant, index) => ({ sku: skuOf(variant.sku), ref: { scope: "newVariant" as const, index } })),
  ];
  const normalized = [...new Set(rows.flatMap((row) => row.sku ?? []))];
  if (!normalized.length) return ok([]);
  const owners = await deps.findSkuOwners(normalized);
  if (!owners.success) return owners;
  // A holder that the request itself edits or deletes lets go of the SKU; the plan already checks the final SKUs against each other.
  const releases = new Set<string>([...input.variants.map((variant) => variant.id as string), ...deleted]);
  return ok(rows.flatMap((row): ValidationIssue[] => {
    const holder = row.sku === undefined ? undefined : owners.data.get(row.sku);
    return holder !== undefined && !releases.has(holder) ? [{ ...row.ref, field: "sku", reason: "DUPLICATE_SKU", message: "SKU is already used" }] : [];
  }));
}

/** Option and value ids the product does not own but that already exist elsewhere, so a new one cannot reuse them. */
async function foreignIds(current: Product, input: SaveProductInput, deps: SaveProductDependencies): Promise<Result<readonly ValidationIssue[], ProductReadError>> {
  const known = new Set<string>(current.options.flatMap((option) => [option.id, ...option.values.map((value) => value.id)]));
  const fresh = [...new Set(input.options.flatMap((option) => [option.id, ...option.values.map((value) => value.id)]).filter((id) => !known.has(id)))];
  if (!fresh.length) return ok([]);
  const existing = await deps.findForeignOptionIds(fresh);
  if (!existing.success) return existing;
  return ok(input.options.flatMap((option, optionIndex): ValidationIssue[] => [
    ...!known.has(option.id) && existing.data.has(option.id) ? [{ scope: "option" as const, optionIndex, optionId: option.id, field: "id" as const, reason: "ID_CONFLICT" as const, message: "Identifier is already used" }] : [],
    ...option.values.flatMap((value, valueIndex): ValidationIssue[] => !known.has(value.id) && existing.data.has(value.id)
      ? [{ scope: "value", optionIndex, valueIndex, valueId: value.id, field: "id", reason: "ID_CONFLICT", message: "Identifier is already used" }] : []),
  ]));
}

type Saved = Readonly<{ detail: Detail; addedPhotos: boolean }>;

/** Ids the product does not already have must exist for the company; the ones it has are guaranteed by the foreign key. */
async function missingPhotos(current: Product, photos: ProductPhotos, deps: SaveProductDependencies): Promise<Result<readonly ValidationIssue[], ImageLookupError>> {
  const stored = new Set<ImageId>(current.photoIds);
  const added = photos.filter((id) => !stored.has(id));
  if (!added.length) return ok([]);
  const found = await deps.findImages(added);
  if (!found.success) return found;
  return ok(photos.flatMap((id, index): ValidationIssue[] => stored.has(id) || found.data.has(id)
    ? [] : [{ scope: "photo", field: "photoIds", index, reason: "PHOTO_NOT_FOUND", message: "Photo is unavailable" }]));
}

async function saveInTransaction(input: SaveProductInput, deps: SaveProductDependencies): Promise<Result<Saved, SaveProductError>> {
  const locked = await deps.lockProduct(input.productId);
  if (!locked.success) return locked;
  const current = locked.data;
  if (!current) return err({ code: "PRODUCT_NOT_FOUND", message: "Product does not exist" });
  if (current.structureVersion !== input.structureVersion) return err({ code: "PRODUCT_CHANGED", message: "Product changed since it was loaded" });
  const ordered = await deps.findOrderedVariantIds(input.deletedVariantIds);
  if (!ordered.success) return ordered;
  const plan = planProductSave(current, input, ordered.data, { newId: deps.newId, now: deps.clock() });
  const skus = await takenSkus(current, input, deps);
  if (!skus.success) return skus;
  const foreign = await foreignIds(current, input, deps);
  if (!foreign.success) return foreign;
  // The list is parsed here too, so a photo of another company is reported together with the plan issues.
  const listed = input.photoIds === undefined ? undefined : parseProductPhotos(input.photoIds);
  const photoLookup = listed?.success && !samePhotos(listed.data, current.photoIds) ? await missingPhotos(current, listed.data, deps) : ok([] as readonly ValidationIssue[]);
  if (!photoLookup.success) return photoLookup;
  const issues = [...plan.success ? [] : plan.error.issues, ...photoLookup.data, ...skus.data, ...foreign.data];
  if (issues.length || !plan.success) return err({ code: "VALIDATION_ERROR", message: "Invalid product", issues: issues as unknown as ValidationError["issues"] });
  const change = plan.data;
  const changed = !isEmptyChange(change);
  if (changed) {
    const applied = await deps.applyStructureChange(change);
    if (!applied.success) return applied;
  }
  const detail = await deps.reload(input.productId);
  if (!detail.success) return detail;
  if (!detail.data) return err({ code: "PRODUCT_NOT_FOUND", message: "Product does not exist" });
  if (changed) deps.observe?.saved?.({
    productId: input.productId, structureVersion: change.product.structureVersion ?? current.structureVersion,
    optionCount: current.options.length + change.insertOptions.length - change.deleteOptionIds.length,
    variantCount: current.variants.length + change.insertVariants.length - change.deleteVariantIds.length,
    createdVariants: change.insertVariants.length, updatedVariants: change.variantFieldChanges.length, deletedVariants: change.deleteVariantIds.length,
    rekeyedVariants: change.rekeyVariants.length, removedValues: change.deleteValueIds.length,
    photoCount: (change.photos ?? current.photoIds).length, photosChanged: change.photos !== undefined,
  });
  const stored = new Set<ImageId>(current.photoIds);
  return ok({ detail: detail.data, addedPhotos: change.photos?.some((id) => !stored.has(id)) ?? false });
}

export async function saveProduct(input: SaveProductInput, access: ProductAccess, deps: SaveProductDependencies): Promise<Result<Detail, SaveProductError>> {
  const saved = await deps.transaction(access.companyId, () => saveInTransaction(input, deps));
  if (!saved.success) {
    deps.observe?.rejected?.({ productId: input.productId, error: saved.error });
    return saved;
  }
  // Removing photos publishes nothing: searches join the current photos only.
  if (saved.data.addedPhotos) await deps.publishProductPhotosAdded(input.productId);
  return ok(saved.data.detail);
}
