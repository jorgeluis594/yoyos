import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { productRepository } from "@core/src/features/products/infrastructure/repository";
import { getProduct } from "@core/src/features/products/application/get";
import { toProductDetailResponse } from "@core/src/features/products/presentation/product-presenter";
import { deleteSeededProducts, seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { ok } from "@shared/functional";
import type { ProductId } from "@core/src/features/products/domain/product";

const companyA = randomUUID();
const companyB = randomUUID();

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.company.deleteMany({ where: { id } });
  });
});

const detail = (id: string) => getProduct(id as ProductId, { repository: productRepository, resolveImage: async () => ok(null) });

test("a product seeded with Color before Talla returns its detail attributes with Color first", async () => {
  await withTenantIsolation(companyA, async () => {
    const { productId } = await seedProduct({ options: [{ name: "Color", values: ["Negro", "Azul"] }, { name: "Talla", values: ["M", "L"] }], variants: [
      { attributes: { Talla: "L", Color: "Azul" }, stock: 2 }, { attributes: { Talla: "M", Color: "Negro" }, stock: 1 }, { attributes: { Talla: "L", Color: "Negro" } }, { attributes: { Talla: "M", Color: "Azul" } },
    ] });
    const read = await detail(productId);
    if (!read.success || !read.data) throw new Error("Product was not loaded");
    const response = toProductDetailResponse(read.data);
    expect(response.product.variants.map((variant) => Object.entries(variant.attributes))).toEqual([
      [["Color", "Negro"], ["Talla", "M"]], [["Color", "Negro"], ["Talla", "L"]], [["Color", "Azul"], ["Talla", "M"]], [["Color", "Azul"], ["Talla", "L"]],
    ]);
    expect(read.data.product).toMatchObject({ structureVersion: 1, options: [{ name: "Color", values: [{ name: "Negro" }, { name: "Azul" }] }, { name: "Talla" }] });
  });
});

test("the loader reads a product without options, inactive variants and every product of a list page", async () => {
  await withTenantIsolation(companyA, async () => {
    const simple = await seedProduct({ variants: [{ sku: "SIMPLE", stock: 3 }] });
    const mixed = await seedProduct({ variants: [{ attributes: { Talla: "M" }, status: "inactive" }, { attributes: { Talla: "L" } }] });
    const simpleRead = await detail(simple.productId);
    expect(simpleRead.success && simpleRead.data?.product).toMatchObject({ options: [], variants: [{ combination: {}, sku: "SIMPLE", status: "active", stock: { quantity: 3 } }] });
    const mixedRead = await detail(mixed.productId);
    expect(mixedRead.success && mixedRead.data?.product.variants.map((variant) => variant.status)).toEqual(["inactive", "active"]);
    const list = await productRepository.list({ sort: "name", page: 1, pageSize: 50 });
    expect(list.success && list.data.items.map((item) => item.id)).toEqual(expect.arrayContaining([simple.productId, mixed.productId]));
  });
});

test("another company cannot read or link options of a product", async () => {
  const mine = await withTenantIsolation(companyA, async () => await seedProduct({ variants: [{ attributes: { Color: "Azul" } }] }));
  await withTenantIsolation(companyB, async () => {
    expect(await prisma.productOption.findMany()).toEqual([]);
    expect(await prisma.productOptionValue.findMany()).toEqual([]);
    expect(await prisma.productVariantOptionValue.findMany()).toEqual([]);
    expect(await detail(mine.productId)).toEqual({ success: true, data: null });
    const foreign = await seedProduct({ variants: [{ attributes: { Color: "Rojo" } }] });
    await expect(prisma.productOption.create({ data: { id: randomUUID(), productId: mine.productId, name: "Intruso", position: 5 } })).rejects.toThrow();
    await expect(prisma.productVariantOptionValue.create({ data: { productId: foreign.productId, variantId: foreign.variantIds[0], optionId: mine.optionIds.Color, valueId: mine.valueIds.Color.Azul } })).rejects.toThrow();
  });
});

test("rejects a link whose value belongs to another option of the product", async () => {
  await withTenantIsolation(companyA, async () => {
    const seeded = await seedProduct({ variants: [{ attributes: { Color: "Azul", Talla: "M" } }] });
    const [variant] = seeded.variantIds;
    await prisma.productVariantOptionValue.deleteMany({ where: { variantId: variant, optionId: seeded.optionIds.Talla } });
    await expect(prisma.productVariantOptionValue.create({ data: { productId: seeded.productId, variantId: variant, optionId: seeded.optionIds.Talla, valueId: seeded.valueIds.Color.Azul } })).rejects.toThrow();
    await prisma.productVariantOptionValue.create({ data: { productId: seeded.productId, variantId: variant, optionId: seeded.optionIds.Talla, valueId: seeded.valueIds.Talla.M } });
  });
});

test("rejects a link that points at a variant of another product", async () => {
  await withTenantIsolation(companyA, async () => {
    const first = await seedProduct({ variants: [{ attributes: { Color: "Azul" } }] });
    const second = await seedProduct({ variants: [{ attributes: { Color: "Rojo" } }] });
    await expect(prisma.productVariantOptionValue.create({ data: { productId: second.productId, variantId: first.variantIds[0], optionId: second.optionIds.Color, valueId: second.valueIds.Color.Rojo } })).rejects.toThrow();
  });
});

test("the combination unique index rejects a duplicate combination", async () => {
  await withTenantIsolation(companyA, async () => {
    const seeded = await seedProduct({ variants: [{ attributes: { Color: "Azul" } }] });
    const key = (await prisma.productVariant.findUniqueOrThrow({ where: { id: seeded.variantIds[0] } })).combinationKey;
    expect(key).toBe(seeded.valueIds.Color.Azul);
    await expect(prisma.productVariant.create({ data: { id: randomUUID(), productId: seeded.productId, combinationKey: key, salePrice: 1, qrCode: randomUUID(), status: "active" } })).rejects.toThrow();
    // The same key in another product is a different combination.
    await prisma.productVariant.create({ data: { id: randomUUID(), productId: (await seedProduct()).productId, combinationKey: key, salePrice: 1, qrCode: randomUUID(), status: "active" } });
  });
});

test("the loader reports invalid stored data for a variant without its value and for a key that does not match", async () => {
  await withTenantIsolation(companyA, async () => {
    const missing = await seedProduct({ variants: [{ attributes: { Color: "Azul" } }] });
    await prisma.productVariantOptionValue.deleteMany({ where: { variantId: missing.variantIds[0] } });
    expect(await detail(missing.productId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    const skewed = await seedProduct({ variants: [{ attributes: { Color: "Azul" } }] });
    await prisma.productVariant.update({ where: { id: skewed.variantIds[0] }, data: { combinationKey: "" } });
    expect(await detail(skewed.productId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  });
});

test("the loader reports invalid stored data for a simple product whose variant is inactive and for an option without values", async () => {
  await withTenantIsolation(companyA, async () => {
    const inactive = await seedProduct({ variants: [{ status: "inactive" }] });
    expect(await detail(inactive.productId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    const empty = await seedProduct({ variants: [{ attributes: { Color: "Azul" } }] });
    await prisma.productVariantOptionValue.deleteMany({ where: { variantId: empty.variantIds[0] } });
    await prisma.productVariant.update({ where: { id: empty.variantIds[0] }, data: { combinationKey: "" } });
    await prisma.productOptionValue.deleteMany({ where: { optionId: empty.optionIds.Color } });
    expect(await detail(empty.productId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  });
});
