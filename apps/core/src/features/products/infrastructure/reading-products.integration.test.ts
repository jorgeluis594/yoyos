import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { deleteSeededProducts, seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { readProductRowsForReading } from "@core/src/features/products/infrastructure/reading-products";
import { findProductsForReading } from "@core/src/features/products/application/find-products-for-reading";
import type { ProductId } from "@core/src/features/products/domain/product";

const companyA = randomUUID();
const companyB = randomUUID();
const read = (ids: readonly ProductId[]) => findProductsForReading(ids, { readRows: readProductRowsForReading });

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.company.delete({ where: { id } });
  });
});

async function polo(companyId: string, name = "Polo básico") {
  return withTenantIsolation(companyId, () => seedProduct({ name, options: [{ name: "Talla", values: ["M", "L"] }, { name: "Color", values: ["Negro", "Blanco"] }], variants: [
    { attributes: { Talla: "M", Color: "Negro" }, salePrice: 35 },
    { attributes: { Talla: "M", Color: "Blanco" }, salePrice: 40 },
    { attributes: { Talla: "L", Color: "Negro" }, salePrice: 35, status: "inactive" },
  ] })).then(({ productId }) => productId as ProductId);
}

test("reads products, variants and attribute order in one snapshot with a fixed number of queries", async () => {
  const [first, second] = [await polo(companyA), await polo(companyA, "Polo oversize")];
  const queries = { products: vi.spyOn(prisma.product, "findMany"), variants: vi.spyOn(prisma.productVariant, "findMany"), raw: vi.spyOn(prisma, "$queryRaw") };
  const count = () => queries.products.mock.calls.length + queries.variants.mock.calls.length + queries.raw.mock.calls.length;
  const single = await withTenantIsolation(companyA, () => read([first]));
  const afterOne = count();
  const several = await withTenantIsolation(companyA, () => read([first, second]));
  const afterTwo = count() - afterOne;
  vi.restoreAllMocks();
  expect(afterOne).toBeLessThanOrEqual(3 + 1);
  expect(afterTwo).toBe(afterOne);
  expect(single.success && single.data).toHaveLength(1);
  expect(several.success && several.data.map(({ name }) => name)).toEqual(["Polo básico", "Polo oversize"]);
});

test("returns the active variants of a product with their prices, attributes and values once", async () => {
  const id = await polo(companyA);
  const result = await withTenantIsolation(companyA, () => read([id]));
  expect(result.success && result.data).toEqual([{
    productId: id, name: "Polo básico", sellable: true,
    attributes: [{ name: "Talla", values: ["M"] }, { name: "Color", values: ["Negro", "Blanco"] }],
    variants: [
      expect.objectContaining({ variantAttributes: { Talla: "M", Color: "Negro" }, unitPrice: { amount: 35, currency: "PEN" } }),
      expect.objectContaining({ variantAttributes: { Talla: "M", Color: "Blanco" }, unitPrice: { amount: 40, currency: "PEN" } }),
    ],
  }]);
});

test("reports a product with no active variant as not sellable and leaves out a deleted one and another company's", async () => {
  const archived = await withTenantIsolation(companyA, () => seedProduct({ name: "Gorra vieja", variants: [{ status: "inactive" }] })).then(({ productId }) => productId as ProductId);
  const deleted = await withTenantIsolation(companyA, () => seedProduct({ name: "Gorra borrada" })).then(({ productId }) => productId as ProductId);
  await withTenantIsolation(companyA, async () => {
    await prisma.productStock.deleteMany({ where: { variant: { productId: deleted } } });
    await prisma.productVariant.deleteMany({ where: { productId: deleted } });
    await prisma.product.delete({ where: { id: deleted } });
  });
  const foreign = await polo(companyB, "Polo ajeno");
  const result = await withTenantIsolation(companyA, () => read([archived, deleted, foreign]));
  expect(result.success && result.data).toEqual([{ productId: archived, name: "Gorra vieja", sellable: false, attributes: [], variants: [] }]);
});

test("rejects a stored product that fails its schema as invalid stored data", async () => {
  // The database constraints already refuse an unsupported currency, so the row that reaches the schema is simulated.
  const id = await polo(companyA, "Polo raro");
  const stored = vi.spyOn(prisma.product, "findMany").mockResolvedValueOnce([{ id, name: "Polo raro", currency: "XXX", status: "active" }] as never);
  const result = await withTenantIsolation(companyA, () => read([id]));
  stored.mockRestore();
  expect(result).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
});
