import { describe, expect, test } from "vitest";
import { updateProduct, type UpdateDependencies, type UpdateInput } from "@core/src/features/products/application/update";
import type { UpdateChanges } from "@core/src/features/products/application/repository";
import type { CompanyId, ImageId, Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { err, ok } from "@shared/functional";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const productId = "00000000-0000-4000-8000-000000000010" as ProductId;
const variantId = "00000000-0000-4000-8000-000000000011" as VariantId;
const secondVariantId = "00000000-0000-4000-8000-000000000012" as VariantId;
const when = new Date("2026-09-01T00:00:00.000Z");

function sample(): Product {
  return {
    id: productId, companyId, name: "Camisa", description: "Algodón", currency: "PEN",
    qrCode: "qr-product", status: "active", createdAt: when, updatedAt: when,
    variants: [{
      id: variantId, productId, attributes: { Talla: "M" }, sku: "CAM-M",
      salePrice: { amount: 20, currency: "PEN" }, purchasePrice: { amount: 10, currency: "PEN" },
      qrCode: "qr-variant", status: "active", stock: { variantId, quantity: 5 },
    }],
  };
}

function multiVariant(): Product {
  const base = sample();
  return { ...base, variants: [...base.variants, {
    id: secondVariantId, productId, attributes: { Talla: "L" }, sku: "CAM-L",
    salePrice: { amount: 25, currency: "PEN" }, qrCode: "qr-variant-2", status: "active",
    stock: { variantId: secondVariantId, quantity: 3 },
  }] };
}

function setup(initial: Product = sample(), options: { imageExists?: boolean; imageError?: boolean; readError?: boolean; updateFails?: boolean } = {}) {
  const stored = initial;
  const updates: UpdateChanges[] = [];
  let clockReads = 0;
  const deps: UpdateDependencies = {
    repository: {
      async get(id) { return options.readError ? err({ code: "INVALID_STORED_DATA" as const, message: "Stored product data is invalid" }) : ok(stored.id === id ? stored : null); },
      async update(_companyId, id, changes) {
        updates.push(changes);
        return options.updateFails ? { success: false as const, error: { code: "DUPLICATE_SKU" as const, message: "SKU is already used" } } : { success: true as const, data: id };
      },
    },
    findImage: async () => options.imageError ? err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" }) : ok(options.imageExists ?? true),
    clock: () => { clockReads += 1; return new Date("2026-10-01T00:00:00.000Z"); },
  };
  return { deps, updates, get clockReads() { return clockReads; }, get stored() { return stored; } };
}

describe("update product", () => {
  test("applies omission, null, and concrete values without mutating the loaded product or patch", async () => {
    const context = setup();
    const input: UpdateInput = { name: "  Camisa nueva  ", description: null, variants: [{ id: variantId, sku: null, salePrice: 30, purchasePrice: 0 }] };
    const snapshot = structuredClone({ product: context.stored, input });
    const result = await updateProduct(companyId, productId, input, context.deps);
    expect(result).toEqual({ success: true, data: productId });
    expect(context.updates).toHaveLength(1);
    expect(context.updates[0]).toEqual({
      product: { name: "Camisa nueva", description: null, updatedAt: new Date("2026-10-01T00:00:00.000Z") },
      variants: [{ id: variantId, sku: null, salePrice: { amount: 30, currency: "PEN" }, purchasePrice: { amount: 0, currency: "PEN" } }],
    });
    expect(context.stored.createdAt).toEqual(when);
    expect(context.stored.name).toBe("Camisa");
    expect(context.stored.variants[0].sku).toBe("CAM-M");
    expect({ product: context.stored, input }).toEqual(snapshot);
  });

  test("updates only the supplied variant and preserves stock, currency, attributes, and QR", async () => {
    const context = setup(multiVariant());
    const result = await updateProduct(companyId, productId, { variants: [{ id: secondVariantId, salePrice: 26 }] }, context.deps);
    expect(result).toEqual({ success: true, data: productId });
    expect(context.updates[0].variants).toEqual([{ id: secondVariantId, salePrice: { amount: 26, currency: "PEN" } }]);
    expect(context.updates[0].product).toEqual({ updatedAt: new Date("2026-10-01T00:00:00.000Z") });
    expect(context.stored.variants[1].stock.quantity).toBe(3);
    expect(context.stored.variants[1].attributes).toEqual({ Talla: "L" });
    expect(context.stored.variants[1].qrCode).toBe("qr-variant-2");
  });

  test("rejects repeated or foreign variant references before writing", async () => {
    const context = setup();
    const repeated = await updateProduct(companyId, productId, { variants: [{ id: variantId, salePrice: 21 }, { id: variantId, salePrice: 22 }] }, context.deps);
    expect(repeated).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    const foreign = await updateProduct(companyId, productId, { variants: [{ id: secondVariantId, salePrice: 21 }] }, context.deps);
    expect(foreign).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    expect(context.updates).toHaveLength(0);
    expect(context.clockReads).toBe(0);
  });

  test("reports a missing target even for an empty patch", async () => {
    const context = setup();
    const result = await updateProduct(companyId, "00000000-0000-4000-8000-000000000099" as ProductId, {}, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
    expect(context.updates).toHaveLength(0);
  });

  test("propagates repository read failures without writing", async () => {
    const context = setup(sample(), { readError: true });
    expect(await updateProduct(companyId, productId, {}, context.deps)).toEqual(err({ code: "INVALID_STORED_DATA", message: "Stored product data is invalid" }));
    expect(context.updates).toHaveLength(0);
    expect(context.clockReads).toBe(0);
  });

  test("treats an empty, unchanged, or already-absent patch as a no-op without reading the clock", async () => {
    const context = setup();
    for (const input of [
      {},
      { name: "Camisa", description: "Algodón", variants: [] },
      { variants: [{ id: variantId, sku: "cam-m", salePrice: 20, purchasePrice: 10 }] },
      { imageId: null },
    ] satisfies UpdateInput[]) {
      expect(await updateProduct(companyId, productId, input, context.deps)).toEqual({ success: true, data: productId });
    }
    expect(context.updates).toHaveLength(0);
    expect(context.clockReads).toBe(0);
  });

  test("still rejects invalid fields when the patch would produce no changes", async () => {
    const context = setup();
    const result = await updateProduct(companyId, productId, { name: "Camisa", variants: [{ id: variantId, salePrice: 0 }] }, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    expect(context.updates).toHaveLength(0);
  });

  test("rejects malformed direct variant references without writing", async () => {
    const context = setup();
    const result = await updateProduct(companyId, productId, { variants: [null] } as unknown as UpdateInput, context.deps);
    expect(result).toEqual({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid product", issues: [{ scope: "variant", index: 0, field: "id", reason: "INVALID_TYPE", message: "Invalid variant" }] } });
    expect(context.updates).toHaveLength(0);
  });

  test("validates image ownership and clears associations explicitly", async () => {
    const context = setup();
    const imageId = "00000000-0000-4000-8000-000000000099" as ImageId;
    expect(await updateProduct(companyId, productId, { imageId }, context.deps)).toEqual({ success: true, data: productId });
    expect(context.updates[0].product.imageId).toBe(imageId);
    const foreign = setup(sample(), { imageExists: false });
    expect(await updateProduct(companyId, productId, { imageId }, foreign.deps)).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
    expect(foreign.updates).toHaveLength(0);
    const cleared = setup({ ...sample(), imageId });
    expect(await updateProduct(companyId, productId, { imageId: null }, cleared.deps)).toEqual({ success: true, data: productId });
    expect(cleared.updates[0].product.imageId).toBeNull();
  });

  test("preserves image lookup failure without writing", async () => {
    const context = setup(sample(), { imageError: true });
    const imageId = "00000000-0000-4000-8000-000000000099" as ImageId;
    expect(await updateProduct(companyId, productId, { imageId }, context.deps)).toEqual(err({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" }));
    expect(context.updates).toHaveLength(0);
    expect(context.clockReads).toBe(0);
  });

  test("returns the duplicate-SKU failure reported by persistence", async () => {
    const context = setup(sample(), { updateFails: true });
    const result = await updateProduct(companyId, productId, { variants: [{ id: variantId, sku: "TAKEN" }] }, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "DUPLICATE_SKU" } });
  });
});
