import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import type { ImageLookupError } from "@core/src/shared/images/application/images";
import { saveProduct, type SaveProductDependencies, type SaveProductError, type SaveProductInput } from "@core/src/features/products/application/save-product";
import type { ProductStructureChange } from "@core/src/features/products/domain/product-structure";
import type { ImageId, OptionId, OptionText, OptionValueId, Product, ProductId, ProductPhotos, VariantId } from "@core/src/features/products/domain/product";

const access = { companyId: "00000000-0000-4000-8000-0000000000c1" as CompanyId };
const productId = "00000000-0000-4000-8000-0000000000a1" as ProductId;
const talla = { id: "o-talla" as OptionId, name: "Talla" as OptionText, values: [{ id: "v-m" as OptionValueId, name: "M" as OptionText }, { id: "v-l" as OptionValueId, name: "L" as OptionText }] as Product["options"][number]["values"] };

function variant(id: string, size: string, sku?: string): Product["variants"][number] {
  return { id: id as VariantId, productId, combination: { [talla.id]: size as OptionValueId }, ...(sku ? { sku } : {}), salePrice: { amount: 10, currency: "PEN" },
    qrCode: `qr-${id}`, status: "active", stock: { variantId: id as VariantId, quantity: 0 } };
}

const image = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as ImageId;
const photos = (...ids: ImageId[]) => ids as unknown as ProductPhotos;

const stored: Product = { id: productId, name: "Polo", photoIds: photos(), currency: "PEN", qrCode: "q", status: "active", createdAt: new Date(0), updatedAt: new Date(0), structureVersion: 3,
  options: [talla], variants: [variant("a", "v-m", "SKU-A"), variant("b", "v-l")] };

const unchanged = (): SaveProductInput => ({
  productId, structureVersion: 3, name: "Polo", description: null,
  options: [{ id: talla.id, name: "Talla", values: talla.values.map((value) => ({ id: value.id, name: value.name })) }],
  variants: [{ id: "a" as VariantId, sku: "SKU-A", salePrice: 10, purchasePrice: null }, { id: "b" as VariantId, sku: null, salePrice: 10, purchasePrice: null }],
  newVariants: [], deletedVariantIds: [],
});

function setup(options: Readonly<{ product?: Product | null; skuOwners?: ReadonlyMap<string, VariantId>; foreign?: ReadonlySet<string>; images?: Result<ReadonlySet<ImageId>, ImageLookupError>; known?: readonly ImageId[]; ordered?: ReadonlySet<VariantId>; applyFails?: SaveProductError }> = {}) {
  const applied: ProductStructureChange[] = [];
  const published: ProductId[] = [];
  const saved: unknown[] = [];
  const rejected: SaveProductError[] = [];
  const skuLookups: (readonly string[])[] = [];
  const imageLookups: (readonly ImageId[])[] = [];
  let counter = 0;
  const deps: SaveProductDependencies = {
    transaction: async (_companyId, work) => work(),
    lockProduct: async () => ok(options.product === undefined ? stored : options.product),
    findOrderedVariantIds: async () => ok(options.ordered ?? new Set()),
    findSkuOwners: async (skus) => { skuLookups.push(skus); return ok(options.skuOwners ?? new Map()); },
    findForeignOptionIds: async () => ok(options.foreign ?? new Set()),
    findImages: async (ids) => { imageLookups.push(ids); return options.images ?? ok(new Set(options.known ?? ids)); },
    applyStructureChange: async (change) => { if (options.applyFails) return err(options.applyFails); applied.push(change); return ok(null); },
    reload: async (id) => ok({ product: { ...stored, id }, orderedVariantIds: new Set<VariantId>(), photos: [] }),
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    clock: () => new Date("2026-10-26T00:00:00.000Z"),
    publishProductPhotosAdded: async (id) => { published.push(id); return ok(undefined); },
    observe: { saved: (summary) => saved.push(summary), rejected: ({ error }) => rejected.push(error) },
  };
  return { deps, applied, published, saved, rejected, skuLookups, imageLookups };
}

describe("save product", () => {
  test("rejects a save with a stale structure version and writes nothing", async () => {
    const context = setup();
    const result = await saveProduct({ ...unchanged(), structureVersion: 2, name: "Otro" }, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "PRODUCT_CHANGED" } });
    expect(context.applied).toEqual([]);
    expect(context.rejected.map((error) => error.code)).toEqual(["PRODUCT_CHANGED"]);
  });

  test("answers PRODUCT_NOT_FOUND for a product of another company or a missing one", async () => {
    const context = setup({ product: null });
    expect(await saveProduct(unchanged(), access, context.deps)).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
  });

  test("returns the product unchanged without writing when nothing changed", async () => {
    const context = setup();
    const result = await saveProduct(unchanged(), access, context.deps);
    expect(result.success).toBe(true);
    expect(context.applied).toEqual([]);
    expect(context.published).toEqual([]);
    expect(context.saved).toEqual([]);
    expect(context.skuLookups).toEqual([]);
  });

  test("writes the plan once with the clock, bumps the version for a structural change and logs the counts", async () => {
    const context = setup();
    const input = { ...unchanged(), name: "Polo básico", newVariants: [], deletedVariantIds: ["b" as VariantId],
      options: [{ id: talla.id, name: "Talla", values: [{ id: "v-m", name: "M" }] }], variants: unchanged().variants.slice(0, 1) };
    expect(await saveProduct(input, access, context.deps)).toMatchObject({ success: true });
    expect(context.applied).toHaveLength(1);
    expect(context.applied[0].product).toEqual({ name: "Polo básico", updatedAt: new Date("2026-10-26T00:00:00.000Z"), structureVersion: 4 });
    expect(context.applied[0].deleteVariantIds).toEqual(["b"]);
    expect(context.saved).toEqual([{ productId, structureVersion: 4, optionCount: 1, variantCount: 1, createdVariants: 0, updatedVariants: 0, deletedVariants: 1, rekeyedVariants: 0, removedValues: 1, photoCount: 0, photosChanged: false }]);
  });

  test("reports duplicate SKUs of two new variants on both rows", async () => {
    const context = setup();
    const input = { ...unchanged(), newVariants: [{ values: ["v-m"], sku: "dup", salePrice: 1 }, { values: ["v-l"], sku: " DUP", salePrice: 1 }] };
    const result = await saveProduct(input, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    if (result.success || result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.issues.filter((issue) => issue.reason === "DUPLICATE_SKU").map((issue) => issue.scope === "newVariant" ? issue.index : -1)).toEqual([0, 1]);
    expect(context.applied).toEqual([]);
  });

  test("reports a SKU used by another product of the company", async () => {
    const context = setup({ skuOwners: new Map([["taken", "other-variant" as VariantId]]) });
    const input = { ...unchanged(), variants: [{ id: "a" as VariantId, sku: "SKU-A", salePrice: 10, purchasePrice: null }, { id: "b" as VariantId, sku: "Taken ", salePrice: 10, purchasePrice: null }] };
    const result = await saveProduct(input, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR", issues: [{ scope: "variant", variantId: "b", field: "sku", reason: "DUPLICATE_SKU" }] } });
    expect(context.skuLookups).toEqual([["taken"]]);
  });

  test("lets two variants of the product swap SKUs and skips the lookup of SKUs they already hold", async () => {
    const withSkus = { ...stored, variants: [variant("a", "v-m", "SKU-A"), variant("b", "v-l", "SKU-B")] as unknown as Product["variants"] };
    const context = setup({ product: withSkus, skuOwners: new Map([["sku-a", "a" as VariantId], ["sku-b", "b" as VariantId]]) });
    const input = { ...unchanged(), variants: [{ id: "a" as VariantId, sku: "SKU-B", salePrice: 10, purchasePrice: null }, { id: "b" as VariantId, sku: "SKU-A", salePrice: 10, purchasePrice: null }] };
    expect(await saveProduct(input, access, context.deps)).toMatchObject({ success: true });
    expect(context.applied[0].variantFieldChanges).toEqual([{ id: "a", sku: "SKU-B" }, { id: "b", sku: "SKU-A" }]);
  });

  test("reports a SKU held by a saved variant the form did not list", async () => {
    const context = setup({ skuOwners: new Map([["sku-a", "a" as VariantId]]) });
    const input = { ...unchanged(), variants: unchanged().variants.slice(1), newVariants: [], deletedVariantIds: [] as VariantId[] };
    expect(await saveProduct({ ...input, variants: [{ id: "b" as VariantId, sku: "sku-a", salePrice: 10, purchasePrice: null }] }, access, context.deps))
      .toMatchObject({ success: false, error: { issues: [{ scope: "variant", variantId: "b", reason: "DUPLICATE_SKU" }] } });
  });

  test("reports option and value ids that belong to another product together with the other issues", async () => {
    const context = setup({ foreign: new Set(["o-new", "v-new"]) });
    const input = { ...unchanged(), name: " ", options: [...unchanged().options, { id: "o-new", name: "Color", values: [{ id: "v-new", name: "Rojo" }], valueForExistingVariants: "v-new" }] };
    const result = await saveProduct(input, access, context.deps);
    if (result.success || result.error.code !== "VALIDATION_ERROR") throw new Error("Expected a validation error");
    expect(result.error.issues.map((issue) => `${issue.scope}:${issue.reason}`).sort()).toEqual(["option:ID_CONFLICT", "product:REQUIRED", "value:ID_CONFLICT"]);
  });

  test("a save without photoIds leaves the stored photos untouched", async () => {
    const context = setup({ product: { ...stored, photoIds: photos(image(1), image(2)) } });
    expect(await saveProduct({ ...unchanged(), name: "Otro" }, access, context.deps)).toMatchObject({ success: true });
    expect(context.applied[0].photos).toBeUndefined();
    expect(context.imageLookups).toEqual([]);
    expect(context.published).toEqual([]);
  });

  test("a save with the same photos in the same order is not a photo change", async () => {
    const context = setup({ product: { ...stored, photoIds: photos(image(1), image(2)) } });
    expect(await saveProduct({ ...unchanged(), photoIds: [image(1), image(2)] }, access, context.deps)).toMatchObject({ success: true });
    expect(context.applied).toEqual([]);
    expect(context.imageLookups).toEqual([]);
    expect(context.published).toEqual([]);
  });

  test("a save that moves the third photo first stores it as primary without raising the structure version", async () => {
    const context = setup({ product: { ...stored, photoIds: photos(image(1), image(2), image(3)) } });
    expect(await saveProduct({ ...unchanged(), photoIds: [image(3), image(1), image(2)] }, access, context.deps)).toMatchObject({ success: true });
    expect(context.applied).toHaveLength(1);
    expect(context.applied[0].photos).toEqual([image(3), image(1), image(2)]);
    expect(context.applied[0].product).toEqual({ updatedAt: new Date("2026-10-26T00:00:00.000Z") });
    expect(context.imageLookups).toEqual([]);
    expect(context.published).toEqual([]);
    expect(context.saved).toEqual([expect.objectContaining({ structureVersion: 3, photoCount: 3, photosChanged: true })]);
  });

  test("a save that only removes photos publishes nothing", async () => {
    const context = setup({ product: { ...stored, photoIds: photos(image(1), image(2)) } });
    expect(await saveProduct({ ...unchanged(), photoIds: [image(2)] }, access, context.deps)).toMatchObject({ success: true });
    expect(context.applied[0].photos).toEqual([image(2)]);
    expect(await saveProduct({ ...unchanged(), photoIds: [] }, access, context.deps)).toMatchObject({ success: true });
    expect(context.applied[1].photos).toEqual([]);
    expect(context.published).toEqual([]);
  });

  test("a save that adds a photo publishes product_photos_added after commit and only looks up the new ids", async () => {
    const context = setup({ product: { ...stored, photoIds: photos(image(1)) } });
    expect(await saveProduct({ ...unchanged(), photoIds: [image(1), image(2)] }, access, context.deps)).toMatchObject({ success: true });
    expect(context.imageLookups).toEqual([[image(2)]]);
    expect(context.published).toEqual([productId]);
  });

  test("a save with nine photos is rejected and writes nothing", async () => {
    const context = setup();
    const result = await saveProduct({ ...unchanged(), name: " ", photoIds: Array.from({ length: 9 }, (_, index) => image(index + 1)) }, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    if (!result.success && result.error.code === "VALIDATION_ERROR") expect(result.error.issues.map((issue) => issue.reason).sort()).toEqual(["REQUIRED", "TOO_MANY_PHOTOS"]);
    expect(context.applied).toEqual([]);
    expect(context.imageLookups).toEqual([]);
  });

  test("a repeated photo and a photo of another company are reported with their index and nothing is written", async () => {
    const repeated = setup();
    expect(await saveProduct({ ...unchanged(), photoIds: [image(1), image(1)] }, access, repeated.deps))
      .toMatchObject({ success: false, error: { issues: [{ scope: "photo", index: 1, reason: "DUPLICATE_PHOTO" }] } });
    const foreign = setup({ product: { ...stored, photoIds: photos(image(1)) }, known: [] });
    expect(await saveProduct({ ...unchanged(), photoIds: [image(1), image(2)] }, access, foreign.deps))
      .toMatchObject({ success: false, error: { issues: [{ scope: "photo", field: "photoIds", index: 1, reason: "PHOTO_NOT_FOUND" }] } });
    expect(repeated.applied).toEqual([]);
    expect(foreign.applied).toEqual([]);
  });

  test("preserves a photo lookup failure without writing", async () => {
    const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" };
    const context = setup({ images: err(failure) });
    expect(await saveProduct({ ...unchanged(), photoIds: [image(1)] }, access, context.deps)).toEqual(err(failure));
    expect(context.applied).toEqual([]);
  });

  test("passes the persistence rejection through and reports it as rejected", async () => {
    const context = setup({ applyFails: { code: "VARIANT_HAS_ORDERS", message: "Variant has orders" } });
    const result = await saveProduct({ ...unchanged(), name: "Otro" }, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VARIANT_HAS_ORDERS" } });
    expect(context.saved).toEqual([]);
    expect(context.published).toEqual([]);
  });
});
