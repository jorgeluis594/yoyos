import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findImageIndexState, findNearestProductImages, hasIndexedProducts, listProductsMissingEmbedding, saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

const model = "openai/test+text-embedding-3-small" as EmbeddingModel;
const otherModel = "openai/other" as EmbeddingModel;
const searchModel = "openai/search-test" as EmbeddingModel; // only the search tests write this model
const vector = (...values: number[]) => values as unknown as EmbeddingVector;
const companyA = randomUUID();
const companyB = randomUUID();

async function product(companyId: string, imageId: string | null) {
  const id = randomUUID() as ProductId;
  await withTenantIsolation(companyId, async () => { await seedProduct({ id, name: "Shirt", qrCode: id, imageId }); });
  return id;
}

async function image(companyId: string) {
  const id = randomUUID() as ImageId;
  await withTenantIsolation(companyId, async () => await prisma.image.create({ data: { id, storageKey: `images/${id}` } }));
  return id;
}

const stored = (companyId: string) => withTenantIsolation(companyId, async () => await
  prisma.$queryRaw<Array<{ imageId: string; model: string; embedding: string }>>`SELECT "imageId", model, embedding::text FROM "ImageEmbedding" ORDER BY model`);

/** Active product with one active variant whose current image has an embedding of the search model. */
async function indexedSellable(companyId: string, values: number[], embeddingModel = searchModel) {
  const imageId = await image(companyId);
  const productId = randomUUID() as ProductId;
  await withTenantIsolation(companyId, async () => {
    await seedProduct({ id: productId, name: "Shirt", qrCode: productId, imageId });
    await saveEmbedding({ imageId, model: embeddingModel, vector: vector(...values) });
  });
  return { productId, imageId };
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.image.deleteMany();
    await prisma.company.delete({ where: { id } });
  });
});

test("saveEmbedding keeps the first embedding of an image and model and the index state follows the product's current image", async () => {
  const [first, second] = [await image(companyA), await image(companyA)];
  const productId = await product(companyA, first);
  await withTenantIsolation(companyA, async () => {
    expect(await findImageIndexState(productId, model)).toEqual({ success: true, data: { imageId: first, indexed: false } });
    expect(await saveEmbedding({ imageId: first, model, vector: vector(1, 0, 0) })).toEqual({ success: true, data: undefined });
    expect(await saveEmbedding({ imageId: first, model, vector: vector(0, 0, 1) })).toEqual({ success: true, data: undefined });
    expect(await findImageIndexState(productId, model)).toEqual({ success: true, data: { imageId: first, indexed: true } });
    expect(await findImageIndexState(productId, otherModel)).toEqual({ success: true, data: { imageId: first, indexed: false } });
    await prisma.product.update({ where: { id: productId }, data: { imageId: second } });
    expect(await findImageIndexState(productId, model)).toEqual({ success: true, data: { imageId: second, indexed: false } });
    expect(await findImageIndexState(randomUUID() as ProductId, model)).toEqual({ success: true, data: null });
  });
  expect((await stored(companyA)).filter((row) => row.imageId === first)).toEqual([{ imageId: first, model, embedding: "[1,0,0]" }]);
});

test("saveEmbedding writes nothing for a deleted image and deleting an image deletes its embeddings", async () => {
  const [kept, deleted] = [await image(companyA), await image(companyA)];
  await withTenantIsolation(companyA, async () => {
    expect(await saveEmbedding({ imageId: randomUUID() as ImageId, model, vector: vector(1, 1, 1) })).toEqual({ success: true, data: undefined });
    await saveEmbedding({ imageId: kept, model, vector: vector(1, 0, 0) });
    await saveEmbedding({ imageId: deleted, model, vector: vector(1, 0, 0) });
    await prisma.image.delete({ where: { id: deleted } });
  });
  const images = (await stored(companyA)).map((row) => row.imageId);
  expect(images).toContain(kept);
  expect(images).not.toContain(deleted);
});

test("listProductsMissingEmbedding lists only active products whose current image lacks an embedding of the model", async () => {
  const [indexed, stale, otherModelOnly, missing] = await Promise.all([1, 2, 3, 4].map(() => image(companyA)));
  const indexedId = await product(companyA, indexed);
  const staleId = await product(companyA, stale);
  const otherModelId = await product(companyA, otherModelOnly);
  const missingId = await product(companyA, missing);
  const withoutImage = await product(companyA, null);
  await withTenantIsolation(companyA, async () => {
    await saveEmbedding({ imageId: indexed, model, vector: vector(1, 0, 0) });
    await saveEmbedding({ imageId: stale, model, vector: vector(1, 0, 0) });
    await prisma.product.update({ where: { id: staleId }, data: { imageId: await image(companyA) } });
    await saveEmbedding({ imageId: otherModelOnly, model: otherModel, vector: vector(1) });
    const result = await listProductsMissingEmbedding(model);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(expect.arrayContaining([staleId, otherModelId, missingId]));
    expect(result.data).not.toContain(indexedId);
    expect(result.data).not.toContain(withoutImage);
  });
  await withTenantIsolation(companyB, async () => expect(await listProductsMissingEmbedding(model)).toEqual({ success: true, data: [] }));
});

test("tenant isolation hides embeddings of another company", async () => {
  const imageId = await image(companyB);
  const productId = await product(companyB, imageId);
  await withTenantIsolation(companyB, () => saveEmbedding({ imageId, model, vector: vector(1, 0, 0) }));
  await withTenantIsolation(companyA, async () => {
    expect(await findImageIndexState(productId, model)).toEqual({ success: true, data: null });
    await saveEmbedding({ imageId, model, vector: vector(0, 0, 1) });
  });
  expect((await stored(companyA)).map((row) => row.imageId)).not.toContain(imageId);
  expect(await stored(companyB)).toEqual([{ imageId, model, embedding: "[1,0,0]" }]);
});

test("hasIndexedProducts is true only when a product of the company has its current image embedded with the model", async () => {
  const company = randomUUID();
  await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
  try {
    const [current, replaced, orphan] = [await image(company), await image(company), await image(company)];
    const productId = await product(company, replaced);
    await withTenantIsolation(company, async () => {
      expect(await hasIndexedProducts(model)).toEqual({ success: true, data: false });
      await saveEmbedding({ imageId: replaced, model, vector: vector(1, 0, 0) });
      await saveEmbedding({ imageId: orphan, model, vector: vector(1, 0, 0) });
      await saveEmbedding({ imageId: current, model: otherModel, vector: vector(1) });
      await prisma.product.update({ where: { id: productId }, data: { imageId: current } });
      expect(await hasIndexedProducts(model)).toEqual({ success: true, data: false });
      expect(await hasIndexedProducts(otherModel)).toEqual({ success: true, data: true });
    });
    await indexedSellable(companyA, [1, 0, 0], model);
    await withTenantIsolation(company, async () => expect(await hasIndexedProducts(model)).toEqual({ success: true, data: false }));
  } finally {
    await withTenantIsolation(company, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await prisma.company.delete({ where: { id: company } });
    });
  }
});

test("findNearestProductImages returns the closest products of the company ordered by distance", async () => {
  const far = await indexedSellable(companyA, [0, 1, 0]);
  const close = await indexedSellable(companyA, [1, 0.1, 0]);
  const exact = await indexedSellable(companyA, [1, 0, 0]);
  await withTenantIsolation(companyA, async () => {
    const found = await findNearestProductImages(vector(1, 0, 0), searchModel, 2);
    expect(found).toMatchObject({ success: true, data: [{ productId: exact.productId, imageId: exact.imageId, distance: 0 }, { productId: close.productId, imageId: close.imageId }] });
    expect(found.success && found.data.map(({ productId }) => productId)).not.toContain(far.productId);
  });
});

test("findNearestProductImages ignores embeddings of another model, of a replaced image and of another company", async () => {
  const replaced = await indexedSellable(companyB, [1, 0, 0]);
  await indexedSellable(companyB, [1, 0, 0], otherModel);
  const current = await indexedSellable(companyB, [0, 1, 0]);
  await indexedSellable(companyA, [1, 0, 0]);
  const newImage = await image(companyB);
  await withTenantIsolation(companyB, async () => {
    await prisma.product.update({ where: { id: replaced.productId }, data: { imageId: newImage } });
    const found = await findNearestProductImages(vector(1, 0, 0), searchModel, 5);
    expect(found.success && found.data.map(({ productId }) => productId)).toEqual([current.productId]);
  });
});

test("hasIndexedProducts and findNearestProductImages ignore a product whose variants are all inactive", async () => {
  const company = randomUUID();
  await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
  try {
    const imageId = await image(company);
    const productId = randomUUID() as ProductId;
    await withTenantIsolation(company, async () => {
      await seedProduct({ id: productId, name: "Shirt", qrCode: productId, imageId, variants: [{ attributes: { Talla: "M" }, status: "inactive" }, { attributes: { Talla: "L" }, status: "inactive" }] });
      await saveEmbedding({ imageId, model: searchModel, vector: vector(1, 0, 0) });
      expect(await hasIndexedProducts(searchModel)).toEqual({ success: true, data: false });
      expect(await findNearestProductImages(vector(1, 0, 0), searchModel, 5)).toEqual({ success: true, data: [] });
    });
    await withTenantIsolation(company, async () => {
      const [first] = await prisma.productVariant.findMany({ where: { productId }, orderBy: { id: "asc" } });
      await prisma.productVariant.update({ where: { id: first.id }, data: { status: "active" } });
      expect(await hasIndexedProducts(searchModel)).toEqual({ success: true, data: true });
    });
  } finally {
    await withTenantIsolation(company, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await prisma.company.delete({ where: { id: company } });
    });
  }
});
