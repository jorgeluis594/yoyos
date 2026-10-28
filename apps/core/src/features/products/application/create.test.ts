import { describe, expect, test } from "vitest";
import { createProduct, type CreateDependencies, type CreateError, type CreateInput } from "@core/src/features/products/application/create";
import { getProduct } from "@core/src/features/products/application/get";
import type { ImageId, Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { countryCurrencies } from "@shared/country";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { ImageLookupError } from "@core/src/shared/images/application/images";
import type { Result } from "@shared/result";

const access = { companyId: "00000000-0000-4000-8000-0000000000c1" as CompanyId };
const base: CreateInput = { name: " Camisa ", currency: "PEN", options: [], variants: [{ values: [], salePrice: 20 }] };
const row = (extra: Partial<CreateInput["variants"][number]> = {}) => ({ values: [], salePrice: 20, ...extra });

function setup(options: Readonly<{ image?: Result<boolean, ImageLookupError>; publishFails?: boolean; skuOwners?: ReadonlyMap<string, VariantId>; foreign?: ReadonlySet<string>; exists?: boolean }> = {}) {
  let stored: Product | null = null;
  const published: ProductId[] = [];
  const created: unknown[] = [];
  const rejected: CreateError[] = [];
  const skuLookups: (readonly string[])[] = [];
  let writes = 0;
  let counter = 0;
  const deps: CreateDependencies = {
    transaction: async (_companyId, work) => work(),
    productExists: async () => ok(options.exists ?? false),
    findImage: async () => options.image ?? ok(true),
    findSkuOwners: async (skus) => { skuLookups.push(skus); return ok(options.skuOwners ?? new Map()); },
    findForeignOptionIds: async () => ok(options.foreign ?? new Set()),
    insertProduct: async (product) => { stored = product; writes++; return ok(product.id); },
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    clock: () => new Date("2026-09-24T00:00:00.000Z"),
    observe: { created: (summary) => created.push(summary), rejected: ({ error }) => rejected.push(error) },
    publishProductImageChanged: async (productId: ProductId) => {
      published.push(productId);
      return options.publishFails ? err({ code: "EVENT_BUS_UNAVAILABLE" as const, message: "down" }) : ok(undefined);
    },
  };
  return { deps, published, created, rejected, skuLookups, get writes() { return writes; }, get stored() { return stored; } };
}

const detailOf = (context: ReturnType<typeof setup>) => (id: ProductId) => getProduct(id, {
  repository: { get: async () => ok(context.stored) }, findOrderedVariantIds: async () => ok(new Set()), snapshot: (read) => read(), resolveImage: async () => ok(null) });

describe("create product", () => {
  test("rejects missing images and preserves lookup failures without writing", async () => {
    const imageId = "00000000-0000-4000-8000-000000000099" as ImageId;
    const missing = setup({ image: ok(false) });
    expect(await createProduct({ ...base, imageId }, access, missing.deps)).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
    expect(missing.writes).toBe(0);

    const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" };
    const unavailable = setup({ image: err(failure) });
    expect(await createProduct({ ...base, imageId }, access, unavailable.deps)).toEqual(err(failure));
    expect(unavailable.writes).toBe(0);
  });

  test("creates and retrieves complete immutable values", async () => {
    const context = setup();
    const input: CreateInput = { ...base, variants: [{ values: [], sku: " A-1 ", salePrice: 19.99, purchasePrice: 0, initialStock: 7 }] };
    const result = await createProduct(input, access, context.deps);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const detail = await detailOf(context)(result.data);
    expect(detail.success && detail.data?.product).toMatchObject({
      name: "Camisa", currency: "PEN", status: "active",
      structureVersion: 1, options: [],
      variants: [{ combination: {}, sku: "A-1", status: "active", salePrice: { amount: 19.99, currency: "PEN" }, purchasePrice: { amount: 0, currency: "PEN" }, stock: { quantity: 7 } }],
    });
    expect(input.variants[0].sku).toBe(" A-1 ");
    expect(context.stored?.createdAt).toEqual(new Date("2026-09-24T00:00:00.000Z"));
    expect(context.stored?.updatedAt).toEqual(context.stored?.createdAt);
    expect(context.stored?.id).not.toBe(context.stored?.variants[0].id);
    expect(context.stored?.qrCode).not.toBe(context.stored?.variants[0].qrCode);
    expect(context.stored?.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(context.stored?.variants[0].id).toBe("00000000-0000-4000-8000-000000000002");
    expect(context.stored?.variants[0].qrCode).toBe("00000000-0000-4000-8000-000000000003");
    expect(context.stored?.qrCode).toBe("00000000-0000-4000-8000-000000000004");
    expect(context.created).toEqual([{ productId: context.stored?.id, optionCount: 0, variantCount: 1 }]);
  });

  test("creates Talla and Color combinations in saved order without the unused S / Azul", async () => {
    const context = setup();
    const talla = { id: "o-talla", name: "Talla", values: [{ id: "t-s", name: "S" }, { id: "t-m", name: "M" }, { id: "t-l", name: "L" }] };
    const color = { id: "o-color", name: "Color", values: [{ id: "c-negro", name: "Negro" }, { id: "c-azul", name: "Azul" }] };
    const combos = [["t-s", "c-negro"], ["t-m", "c-negro"], ["t-m", "c-azul"], ["t-l", "c-negro"], ["t-l", "c-azul"]];
    const result = await createProduct({ ...base, options: [talla, color], variants: combos.map((values) => row({ values, initialStock: 2 })) as unknown as CreateInput["variants"] }, access, context.deps);
    expect(result.success).toBe(true);
    expect(context.stored?.options.map((option) => option.name)).toEqual(["Talla", "Color"]);
    expect(context.stored?.variants).toHaveLength(5);
    expect(context.stored?.variants.map((variant) => Object.values(variant.combination))).toEqual(combos);
    expect(new Set(context.stored?.variants.map((variant) => variant.qrCode)).size).toBe(5);
    expect(context.stored?.variants.every((variant) => variant.status === "active" && variant.stock.quantity === 2)).toBe(true);
    expect(context.created).toEqual([{ productId: context.stored?.id, optionCount: 2, variantCount: 5 }]);
  });

  test("a create whose variants never use Azul stores Color without Azul", async () => {
    const context = setup();
    const color = { id: "o-color", name: "Color", values: [{ id: "c-negro", name: "Negro" }, { id: "c-azul", name: "Azul" }] };
    expect((await createProduct({ ...base, options: [color], variants: [row({ values: ["c-negro"] })] }, access, context.deps)).success).toBe(true);
    expect(context.stored?.options[0].values.map((value) => value.name)).toEqual(["Negro"]);
  });

  test("rejects four options, 31 values and 101 variants together with typed issues", async () => {
    const context = setup();
    const many = { id: "o-many", name: "Muchos", values: Array.from({ length: 31 }, (_, index) => ({ id: `m-${index}`, name: `V${index}` })) };
    const extra = [1, 2, 3].map((index) => ({ id: `o-${index}`, name: `Opción ${index}`, values: [{ id: `e-${index}`, name: "x" }] }));
    const variants = Array.from({ length: 101 }, () => row());
    const result = await createProduct({ ...base, options: [many, ...extra], variants: variants as unknown as CreateInput["variants"] }, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    if (!result.success && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["TOO_MANY_OPTIONS", "TOO_MANY_VALUES", "TOO_MANY_VARIANTS"]));
    }
    expect(context.writes).toBe(0);
    expect(context.rejected).toHaveLength(1);
  });

  test("reports a repeated SKU on both rows and a SKU of another variant on its row", async () => {
    const twice = setup();
    const repeated = await createProduct({ ...base, options: [{ id: "o-1", name: "Talla", values: [{ id: "a", name: "S" }, { id: "b", name: "M" }] }],
      variants: [row({ values: ["a"], sku: "POLO-01" }), row({ values: ["b"], sku: " polo-01 " })] }, access, twice.deps);
    expect(repeated).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    if (!repeated.success && repeated.error.code === "VALIDATION_ERROR") {
      expect(repeated.error.issues.filter((issue) => issue.reason === "DUPLICATE_SKU").map((issue) => issue.scope === "newVariant" && issue.index)).toEqual(expect.arrayContaining([0, 1]));
    }
    expect(twice.writes).toBe(0);

    const taken = setup({ skuOwners: new Map([["polo-01", "other" as VariantId]]) });
    const result = await createProduct({ ...base, variants: [row({ sku: "POLO-01" })] }, access, taken.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR", issues: [{ scope: "newVariant", index: 0, field: "sku", reason: "DUPLICATE_SKU" }] } });
    expect(taken.skuLookups).toEqual([["polo-01"]]);
    const free = setup();
    expect((await createProduct({ ...base, variants: [row({ sku: "POLO-01" })] }, access, free.deps)).success).toBe(true);
  });

  test("reports option and value ids used outside the product as ID_CONFLICT issues", async () => {
    const context = setup({ foreign: new Set(["a", "o-1"]) });
    const result = await createProduct({ ...base, options: [{ id: "o-1", name: "Talla", values: [{ id: "a", name: "S" }, { id: "b", name: "M" }] }],
      variants: [row({ values: ["a"] }), row({ values: ["b"] })] }, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR", issues: [
      { scope: "option", optionIndex: 0, field: "id", reason: "ID_CONFLICT" },
      { scope: "value", optionIndex: 0, valueIndex: 0, field: "id", reason: "ID_CONFLICT" },
    ] } });
    expect(context.writes).toBe(0);
  });

  test("answers PRODUCT_ID_CONFLICT before validating anything", async () => {
    const context = setup({ exists: true });
    const result = await createProduct({ ...base, id: "00000000-0000-4000-8000-000000000077" as ProductId, name: " " }, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "PRODUCT_ID_CONFLICT" } });
    expect(context.writes).toBe(0);
  });

  test("collects independent validation errors before any write", async () => {
    const context = setup();
    const input = { name: " ", currency: "XYZ", options: [], variants: [
      { values: [], sku: " A ", salePrice: 0, initialStock: -1 },
      { values: [], sku: "a", salePrice: 1.001 },
      { values: [], salePrice: 2 },
    ] } as unknown as CreateInput;
    const result = await createProduct(input, access, context.deps);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") expect(result.error.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining([
      "REQUIRED", "INVALID_CURRENCY", "INVALID_PRICE", "INVALID_STOCK", "DUPLICATE_SKU", "INVALID_PRECISION", "DUPLICATE_COMBINATION",
    ]));
    expect(context.writes).toBe(0);
    expect(await createProduct({ ...base, variants: [] } as unknown as CreateInput, access, context.deps)).toMatchObject({ success: false });
  });

  test("rejects malformed direct variant inputs without writing", async () => {
    const context = setup();
    const result = await createProduct({ ...base, variants: [null, "invalid"] } as unknown as CreateInput, access, context.deps);
    expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    if (!result.success && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        { scope: "newVariant", index: 0, field: "values", reason: "INVALID_TYPE", message: "Invalid variant" },
        { scope: "newVariant", index: 1, field: "values", reason: "INVALID_TYPE", message: "Invalid variant" },
      ]));
    }
    expect(context.writes).toBe(0);
  });

  test("uses database-compatible character limits, price precision, and safe stock", async () => {
    const context = setup();
    const valid = await createProduct({
      name: "🧵".repeat(200), description: "🧵".repeat(5000), currency: "PEN", options: [],
      variants: [{ values: [], sku: "🧵".repeat(100), salePrice: 999999999.99, purchasePrice: 0, initialStock: Number.MAX_SAFE_INTEGER }],
    }, access, context.deps);
    expect(valid.success).toBe(true);
    expect(context.stored?.variants[0].stock.quantity).toBe(Number.MAX_SAFE_INTEGER);
    const invalid = await createProduct({
      name: "🧵".repeat(201), description: "🧵".repeat(5001), currency: "PEN", options: [],
      variants: [{ values: [], sku: "🧵".repeat(101), salePrice: 1.001, purchasePrice: -1, initialStock: Number.MAX_SAFE_INTEGER + 1 }],
    }, access, context.deps);
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
      ...base, variants: [{ values: [], salePrice: Number.NaN, purchasePrice: Number.POSITIVE_INFINITY, initialStock: 1.5 }],
    }, access, context.deps);
    expect(result.success).toBe(false);
    if (!result.success && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.issues.map((issue) => issue.reason)).toEqual(["INVALID_PRICE", "INVALID_PRICE", "INVALID_STOCK"]);
    }
    expect(context.writes).toBe(0);
  });

  test("distinguishes absence, absent image, missing image, and technical failure", async () => {
    const context = setup();
    const detail = detailOf(context);
    expect(await detail("00000000-0000-4000-8000-999999999999" as ProductId)).toEqual({ success: true, data: null });
    const created = await createProduct(base, access, context.deps);
    if (!created.success) return;
    expect(await detail(created.data)).toMatchObject({ success: true, data: { product: {} } });
    const stored = context.stored!;
    const deps = { findOrderedVariantIds: async () => ok(new Set<VariantId>()), snapshot: <T>(read: () => Promise<T>) => read() };
    const withImage = { get: async () => ok({ ...stored, imageId: "00000000-0000-4000-8000-000000000099" as Product["imageId"] }) };
    expect(await getProduct(created.data, { ...deps, repository: withImage, resolveImage: async () => ok(null) })).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
    const readFailure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" });
    expect(await getProduct(created.data, { ...deps, repository: { get: async () => readFailure }, resolveImage: async () => ok(null) })).toEqual(readFailure);
    await expect(getProduct(created.data, { ...deps, repository: withImage, resolveImage: async () => { throw new Error("storage failed"); } })).rejects.toThrow("storage failed");
  });

  test("publishes product_image_changed after creating a product with an image", async () => {
    const imageId = "00000000-0000-4000-8000-000000000099" as ImageId;
    const withImage = setup();
    const result = await createProduct({ ...base, imageId }, access, withImage.deps);
    expect(withImage.published).toEqual([result.success && result.data]);
    const withoutImage = setup();
    await createProduct(base, access, withoutImage.deps);
    expect(withoutImage.published).toEqual([]);
  });

  test("returns the saved product when publishing the event fails", async () => {
    const context = setup({ publishFails: true });
    const result = await createProduct({ ...base, imageId: "00000000-0000-4000-8000-000000000099" as ImageId }, access, context.deps);
    expect(result).toMatchObject({ success: true });
    expect(context.writes).toBe(1);
  });

  test("runs the whole flow in the tenant transaction", async () => {
    const context = setup();
    const seen: string[] = [];
    const deps: CreateDependencies = { ...context.deps, transaction: async (companyId, work) => { seen.push(companyId); return work(); } };
    await createProduct(base, access, deps);
    expect(seen).toEqual([access.companyId]);
  });
});
