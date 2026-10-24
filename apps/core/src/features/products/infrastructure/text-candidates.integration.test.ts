import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import { findTextCandidates } from "@core/src/features/products/infrastructure/text-candidates";
import { hasActiveProducts } from "@core/src/features/products/infrastructure/catalog-search-readiness";
import { catalogSearchReadiness } from "@core/src/features/products/application/catalog-search-readiness";
import { hasIndexedProducts } from "@core/src/features/products/infrastructure/image-embeddings";
import { loadSellableVariants } from "@core/src/features/products/infrastructure/order-stock";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";
import type { ProductId } from "@core/src/features/products/domain/product";

const model = "openai/text-test" as EmbeddingModel;
const companyA = randomUUID();
const companyB = randomUUID();
const options = { limit: 8, minSimilarity: 0.3 };

async function product(companyId: string, name: string, variants: readonly { price: number; attributes?: Record<string, string> }[], status = "active", imageId: string | null = null) {
  const id = randomUUID() as ProductId;
  await withTenantIsolation(companyId, async () => {
    await prisma.product.create({ data: { id, name, currency: "PEN", qrCode: id, status, imageId, createdAt: new Date(), updatedAt: new Date() } });
    for (const variant of variants) await prisma.productVariant.create({ data: { id: randomUUID(), productId: id, qrCode: randomUUID(), attributes: variant.attributes ?? {}, sku: null, salePrice: variant.price, status: "active" } });
  });
  return id;
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.image.deleteMany();
    await prisma.company.delete({ where: { id } });
  });
});

test("text candidates come only from the company's active sellable products with their price range", async () => {
  const basic = await product(companyA, "Polo básico", [{ price: 35 }, { price: 40 }]);
  await product(companyA, "Polo sin variantes", []);
  await product(companyA, "Gorra", [{ price: 20 }]);
  await product(companyB, "Polo de otra empresa", [{ price: 1 }]);
  const result = await withTenantIsolation(companyA, () => findTextCandidates([{ mention: "polo basico" }, { mention: "zapatillas" }], options));
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data).toHaveLength(2);
  expect(result.data[0]!.map(({ productId, name, minPrice, maxPrice }) => ({ productId, name, minPrice, maxPrice })))
    .toEqual([{ productId: basic, name: "Polo básico", minPrice: { amount: 35, currency: "PEN" }, maxPrice: { amount: 40, currency: "PEN" } }]);
  expect(result.data[0]![0]!.similarity).toBeGreaterThan(0.3);
  expect(result.data[1]).toEqual([]);
});

test("loads the sellable variants of several products in one call and omits products without variants", async () => {
  const sizes = await product(companyA, "Camisa", [{ price: 50, attributes: { Talla: "M" } }, { price: 55, attributes: { Talla: "L" } }]);
  const bare = await product(companyA, "Camisa sin variantes", []);
  const loaded = await withTenantIsolation(companyA, () => loadSellableVariants([sizes, bare]));
  expect(loaded.success && loaded.data.map(({ productId, name, variants }) => ({ productId, name, sizes: variants.map(({ variantAttributes }) => variantAttributes.Talla).sort() })))
    .toEqual([{ productId: sizes, name: "Camisa", sizes: ["L", "M"] }]);
});

test("search readiness reports no searchable photos until an active product image is embedded", async () => {
  const deps = (visualModel: EmbeddingModel | null) => ({ visualModel, hasActiveProducts, hasIndexedProducts });
  const empty = randomUUID();
  await withTenantIsolation(empty, async () => await prisma.company.create({ data: { id: empty, name: empty, country: "PE" } }));
  expect(await withTenantIsolation(empty, () => catalogSearchReadiness(deps(model)))).toEqual({ success: true, data: "no_active_products" });
  await withTenantIsolation(empty, async () => await prisma.company.delete({ where: { id: empty } }));

  const imageId = randomUUID();
  await withTenantIsolation(companyB, async () => await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } }));
  await product(companyB, "Polo con foto", [{ price: 10 }], "active", imageId);
  expect(await withTenantIsolation(companyB, () => catalogSearchReadiness(deps(model)))).toEqual({ success: true, data: "no_searchable_photos" });
  await withTenantIsolation(companyB, () => saveEmbedding({ imageId: imageId as never, model, vector: [1, 0, 0] as unknown as EmbeddingVector }));
  expect(await withTenantIsolation(companyB, () => catalogSearchReadiness(deps(model)))).toEqual({ success: true, data: "ready" });
  expect(await withTenantIsolation(companyB, () => catalogSearchReadiness(deps(null)))).toEqual({ success: true, data: "no_searchable_photos" });
});
