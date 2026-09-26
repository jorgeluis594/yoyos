import { describe, expect, test } from "vitest";
import { createProduct, type CreateInput } from "@core/src/features/products/application/create";
import { getProduct } from "@core/src/features/products/application/get";
import type { ImageId, Product, ProductId } from "@core/src/features/products/domain/product";
import { countryCurrencies } from "@shared/country";
import { err, ok } from "@shared/functional";
import type { ImageLookupError } from "@core/src/shared/images/application/images";
import type { Result } from "@shared/result";

const base: CreateInput = { name: " Camisa ", currency: "PEN", variants: [{ attributes: {}, salePrice: 20 }] };

function setup(image: Result<boolean, ImageLookupError> = ok(true)) {
  let stored: Product | null = null;
  let writes = 0;
  let counter = 0;
  const deps = {
    repository: {
      async create(product: Product) { stored = product; writes++; return { success: true as const, data: product.id }; },
      async get(id: ProductId) { return ok(stored?.id === id ? stored : null); },
    },
    findImage: async () => image,
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    clock: () => new Date("2026-09-24T00:00:00.000Z"),
  };
  return { deps, get writes() { return writes; }, get stored() { return stored; } };
}

describe("create product", () => {
  test("rejects missing images and preserves lookup failures without writing", async () => {
    const imageId = "00000000-0000-4000-8000-000000000099" as ImageId;
    const missing = setup(ok(false));
    expect(await createProduct({ ...base, imageId }, missing.deps)).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
    expect(missing.writes).toBe(0);

    const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" };
    const unavailable = setup(err(failure));
    expect(await createProduct({ ...base, imageId }, unavailable.deps)).toEqual(err(failure));
    expect(unavailable.writes).toBe(0);
  });

  test("creates and retrieves complete immutable values", async () => {
    const context = setup();
    const input: CreateInput = { ...base, variants: [
      { attributes: { Color: " Azul " }, sku: " A-1 ", salePrice: 19.99, purchasePrice: 0, initialStock: 7 },
      { attributes: { Color: "Rojo" }, salePrice: 999999999.99 },
    ] };
    const result = await createProduct(input, context.deps);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const detail = await getProduct(result.data, { repository: context.deps.repository, resolveImage: async () => null });
    expect(detail.success && detail.data?.product).toMatchObject({
      name: "Camisa", currency: "PEN", status: "active",
      variants: [
        { sku: "A-1", salePrice: { amount: 19.99, currency: "PEN" }, purchasePrice: { amount: 0, currency: "PEN" }, stock: { quantity: 7 } },
        { salePrice: { amount: 999999999.99, currency: "PEN" }, stock: { quantity: 0 } },
      ],
    });
    expect(input.variants[0].sku).toBe(" A-1 ");
    expect(input.variants[0].attributes).toEqual({ Color: " Azul " });
    expect(context.stored?.createdAt).toEqual(new Date("2026-09-24T00:00:00.000Z"));
    expect(context.stored?.updatedAt).toEqual(context.stored?.createdAt);
    expect(context.stored?.id).not.toBe(context.stored?.variants[0].id);
    expect(context.stored?.qrCode).not.toBe(context.stored?.variants[0].qrCode);
    expect(context.stored?.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(context.stored?.variants[0].id).toBe("00000000-0000-4000-8000-000000000002");
    expect(context.stored?.variants[0].qrCode).toBe("00000000-0000-4000-8000-000000000003");
    expect(context.stored?.qrCode).toBe("00000000-0000-4000-8000-000000000006");
  });

  test("collects independent validation errors before any write", async () => {
    const context = setup();
    const input = { name: " ", currency: "XYZ", variants: [
      { attributes: { Color: " Azul ", color: "rojo" }, sku: " A ", salePrice: 0, initialStock: -1 },
      { attributes: {}, sku: "a", salePrice: 1.001 },
      { attributes: {}, salePrice: 2 },
    ] } as unknown as CreateInput;
    const result = await createProduct(input, context.deps);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") expect(result.error.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining([
      "REQUIRED", "INVALID_CURRENCY", "INVALID_ATTRIBUTES", "INVALID_PRICE", "INVALID_STOCK", "DUPLICATE_SKU", "INVALID_PRECISION", "DUPLICATE_ATTRIBUTES",
    ]));
    expect(context.writes).toBe(0);
    expect(await createProduct({ ...base, variants: [] } as unknown as CreateInput, context.deps)).toMatchObject({ success: false });
  });

  test("rejects malformed direct variant inputs without writing", async () => {
    const context = setup();
    const result = await createProduct({ ...base, variants: [null, "invalid"] } as unknown as CreateInput, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    if (!result.success && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.issues).toEqual([
        { scope: "variant", index: 0, field: "attributes", reason: "INVALID_TYPE", message: "Invalid variant" },
        { scope: "variant", index: 1, field: "attributes", reason: "INVALID_TYPE", message: "Invalid variant" },
      ]);
    }
    expect(context.writes).toBe(0);
  });

  test("uses database-compatible character limits, price precision, and safe stock", async () => {
    const context = setup();
    const valid = await createProduct({
      name: "🧵".repeat(200), description: "🧵".repeat(5000), currency: "PEN",
      variants: [{ attributes: {}, sku: "🧵".repeat(100), salePrice: 999999999.99, purchasePrice: 0, initialStock: Number.MAX_SAFE_INTEGER }],
    }, context.deps);
    expect(valid.success).toBe(true);
    expect(context.stored?.variants[0].stock.quantity).toBe(Number.MAX_SAFE_INTEGER);
    const invalid = await createProduct({
      name: "🧵".repeat(201), description: "🧵".repeat(5001), currency: "PEN",
      variants: [{ attributes: {}, sku: "🧵".repeat(101), salePrice: 1.001, purchasePrice: -1, initialStock: Number.MAX_SAFE_INTEGER + 1 }],
    }, context.deps);
    expect(invalid.success).toBe(false);
    if (!invalid.success && invalid.error.code === "VALIDATION_ERROR") {
      expect(invalid.error.issues.filter((issue) => issue.reason === "TOO_LONG")).toHaveLength(3);
      expect(invalid.error.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["INVALID_PRECISION", "INVALID_PRICE", "INVALID_STOCK"]));
    }
    expect(context.writes).toBe(1);
    expect(countryCurrencies).toEqual({ PE: "PEN", US: "USD", CO: "COP", AR: "ARS", CL: "CLP", BR: "BRL" });
  });

  test("rejects non-finite prices and fractional stock", async () => {
    const context = setup();
    const result = await createProduct({
      ...base, variants: [{ attributes: {}, salePrice: Number.NaN, purchasePrice: Number.POSITIVE_INFINITY, initialStock: 1.5 }],
    }, context.deps);
    expect(result.success).toBe(false);
    if (!result.success && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.issues.map((issue) => issue.reason)).toEqual(["INVALID_PRICE", "INVALID_PRICE", "INVALID_STOCK"]);
    }
    expect(context.writes).toBe(0);
  });

  test("accepts the maximum total stock and rejects an overflow before writing", async () => {
    const allowed = setup();
    const variants = [
      { attributes: { Color: "Azul" }, salePrice: 1, initialStock: Number.MAX_SAFE_INTEGER - 1 },
      { attributes: { Color: "Rojo" }, salePrice: 1, initialStock: 1 },
    ] as const;
    expect((await createProduct({ ...base, variants }, allowed.deps)).success).toBe(true);
    expect(allowed.writes).toBe(1);

    const rejected = setup();
    const result = await createProduct({ ...base, variants: [variants[0], { ...variants[1], initialStock: 2 }] }, rejected.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR", issues: [
      { scope: "product", field: "variants", reason: "INVALID_TOTAL_STOCK" },
    ] } });
    expect(rejected.writes).toBe(0);
  });

  test("distinguishes absence, absent image, missing image, and technical failure", async () => {
    const context = setup();
    const missing = await getProduct("00000000-0000-4000-8000-999999999999" as ProductId, { repository: context.deps.repository, resolveImage: async () => null });
    expect(missing).toEqual({ success: true, data: null });
    const created = await createProduct(base, context.deps);
    if (!created.success) return;
    expect(await getProduct(created.data, { repository: context.deps.repository, resolveImage: async () => null })).toMatchObject({ success: true, data: { product: {} } });
    const withImage = { ...context.deps.repository, get: async () => ok({ ...context.stored!, imageId: "00000000-0000-4000-8000-000000000099" as Product["imageId"] }) };
    expect(await getProduct(created.data, { repository: withImage, resolveImage: async () => null })).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
    const readFailure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" });
    expect(await getProduct(created.data, { repository: { ...context.deps.repository, get: async () => readFailure }, resolveImage: async () => null })).toEqual(readFailure);
    await expect(getProduct(created.data, { repository: withImage, resolveImage: async () => { throw new Error("storage failed"); } })).rejects.toThrow("storage failed");
  });
});
