import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findImageIndexState, listProductsMissingEmbedding, saveEmbedding } from "@core/src/features/products/infrastructure/product-image-embeddings";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

const model = "openai/test+text-embedding-3-small" as EmbeddingModel;
const otherModel = "openai/other" as EmbeddingModel;
const vector = (...values: number[]) => values as unknown as EmbeddingVector;
const companyA = randomUUID();
const companyB = randomUUID();

async function product(companyId: string, imageId: string | null) {
  const id = randomUUID() as ProductId;
  await withTenantIsolation(companyId, async () => await prisma.product.create({ data: { id, name: "Shirt", currency: "PEN", qrCode: id, status: "active", imageId,
    createdAt: new Date(), updatedAt: new Date() } }));
  return id;
}

async function image(companyId: string) {
  const id = randomUUID() as ImageId;
  await withTenantIsolation(companyId, async () => await prisma.image.create({ data: { id, storageKey: `images/${id}` } }));
  return id;
}

const stored = (companyId: string) => withTenantIsolation(companyId, async () => await
  prisma.$queryRaw<Array<{ productId: string; imageId: string; model: string; embedding: string }>>`SELECT "productId", "imageId", model, embedding::text FROM "ProductImageEmbedding" ORDER BY model`);

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await prisma.product.deleteMany();
    await prisma.image.deleteMany();
    await prisma.company.delete({ where: { id } });
  });
});

test("saveEmbedding overwrites the embedding of the same product and model", async () => {
  const [first, second] = [await image(companyA), await image(companyA)];
  const productId = await product(companyA, first);
  await withTenantIsolation(companyA, async () => {
    expect(await saveEmbedding({ productId, imageId: first, model, vector: vector(1, 0, 0) })).toEqual({ success: true, data: "saved" });
    expect(await findImageIndexState(productId, model)).toEqual({ success: true, data: { imageId: first, indexedImageId: first } });
    await prisma.product.update({ where: { id: productId }, data: { imageId: second } });
    expect(await findImageIndexState(productId, model)).toEqual({ success: true, data: { imageId: second, indexedImageId: first } });
    expect(await saveEmbedding({ productId, imageId: second, model, vector: vector(0, 1, 0) })).toEqual({ success: true, data: "saved" });
    expect(await findImageIndexState(randomUUID() as ProductId, model)).toEqual({ success: true, data: null });
  });
  expect((await stored(companyA)).filter((row) => row.productId === productId)).toEqual([{ productId, imageId: second, model, embedding: "[0,1,0]" }]);
});

test("saveEmbedding writes nothing when the product no longer has that image", async () => {
  const [old, current] = [await image(companyA), await image(companyA)];
  const productId = await product(companyA, current);
  await withTenantIsolation(companyA, async () =>
    expect(await saveEmbedding({ productId, imageId: old, model, vector: vector(1, 1, 1) })).toEqual({ success: true, data: "image_replaced" }));
  expect((await stored(companyA)).filter((row) => row.productId === productId)).toEqual([]);
});

test("listProductsMissingEmbedding lists only active products whose current image lacks an embedding of the model", async () => {
  const [indexed, stale, otherModelOnly, missing] = await Promise.all([1, 2, 3, 4].map(() => image(companyA)));
  const indexedId = await product(companyA, indexed);
  const staleId = await product(companyA, stale);
  const otherModelId = await product(companyA, otherModelOnly);
  const missingId = await product(companyA, missing);
  const withoutImage = await product(companyA, null);
  await withTenantIsolation(companyA, async () => {
    await saveEmbedding({ productId: indexedId, imageId: indexed, model, vector: vector(1, 0, 0) });
    await saveEmbedding({ productId: staleId, imageId: stale, model, vector: vector(1, 0, 0) });
    await prisma.product.update({ where: { id: staleId }, data: { imageId: await image(companyA) } });
    await saveEmbedding({ productId: otherModelId, imageId: otherModelOnly, model: otherModel, vector: vector(1) });
    const result = await listProductsMissingEmbedding(model);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(expect.arrayContaining([staleId, otherModelId, missingId]));
    expect(result.data).not.toContain(indexedId);
    expect(result.data).not.toContain(withoutImage);
  });
  await withTenantIsolation(companyB, async () => expect(await listProductsMissingEmbedding(model)).toEqual({ success: true, data: [] }));
});

test("deleting a product deletes its embeddings", async () => {
  const imageId = await image(companyA);
  const productId = await product(companyA, imageId);
  await withTenantIsolation(companyA, async () => {
    await saveEmbedding({ productId, imageId, model, vector: vector(1, 0, 0) });
    await prisma.product.delete({ where: { id: productId } });
  });
  expect((await stored(companyA)).filter((row) => row.productId === productId)).toEqual([]);
});

test("tenant isolation hides embeddings of another company", async () => {
  const imageId = await image(companyB);
  const productId = await product(companyB, imageId);
  await withTenantIsolation(companyB, () => saveEmbedding({ productId, imageId, model, vector: vector(1, 0, 0) }));
  await withTenantIsolation(companyA, async () => {
    expect(await findImageIndexState(productId, model)).toEqual({ success: true, data: null });
    expect(await saveEmbedding({ productId, imageId, model, vector: vector(0, 0, 1) })).toEqual({ success: true, data: "image_replaced" });
  });
  expect((await stored(companyA)).map((row) => row.productId)).not.toContain(productId);
  expect(await stored(companyB)).toEqual([{ productId, imageId, model, embedding: "[1,0,0]" }]);
});
