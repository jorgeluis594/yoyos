import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findPhotoIndexState, findNearestProductImages, hasIndexedProducts, listProductsMissingEmbedding, saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
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
  await withTenantIsolation(companyId, async () => { await seedProduct({ id, name: "Shirt", qrCode: id, photoIds: imageId ? [imageId] : [] }); });
  return id;
}

/** The product's photos become exactly these images in this order, as a save with that list would leave them. */
async function setPhotos(productId: string, imageIds: readonly string[]) {
  await prisma.productPhoto.deleteMany({ where: { productId } });
  await prisma.productPhoto.createMany({ data: imageIds.map((imageId, position) => ({ productId, imageId, position })) });
}
const setPrimary = (productId: string, imageId: string) => setPhotos(productId, [imageId]);

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
    await seedProduct({ id: productId, name: "Shirt", qrCode: productId, photoIds: [imageId] });
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

test("saveEmbedding keeps the first embedding of an image and model and the index state follows the product's photos in order", async () => {
  const [first, second] = [await image(companyA), await image(companyA)];
  const productId = await product(companyA, first);
  await withTenantIsolation(companyA, async () => {
    expect(await findPhotoIndexState(productId, model)).toEqual({ success: true, data: [{ imageId: first, indexed: false }] });
    expect(await saveEmbedding({ imageId: first, model, vector: vector(1, 0, 0) })).toEqual({ success: true, data: undefined });
    expect(await saveEmbedding({ imageId: first, model, vector: vector(0, 0, 1) })).toEqual({ success: true, data: undefined });
    expect(await findPhotoIndexState(productId, model)).toEqual({ success: true, data: [{ imageId: first, indexed: true }] });
    expect(await findPhotoIndexState(productId, otherModel)).toEqual({ success: true, data: [{ imageId: first, indexed: false }] });
    await setPhotos(productId, [second, first]);
    expect(await findPhotoIndexState(productId, model)).toEqual({ success: true, data: [{ imageId: second, indexed: false }, { imageId: first, indexed: true }] });
    expect(await findPhotoIndexState(randomUUID() as ProductId, model)).toEqual({ success: true, data: null });
  });
  expect((await stored(companyA)).filter((row) => row.imageId === first)).toEqual([{ imageId: first, model, embedding: "[1,0,0]" }]);
});

test("findPhotoIndexState answers an empty list for a product without photos", async () => {
  const productId = await product(companyA, null);
  await withTenantIsolation(companyA, async () => expect(await findPhotoIndexState(productId, model)).toEqual({ success: true, data: [] }));
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

test("listProductsMissingEmbedding includes a product whose second photo lacks an embedding", async () => {
  const [first, second] = [await image(companyA), await image(companyA)];
  const partial = await product(companyA, first);
  await withTenantIsolation(companyA, async () => {
    await setPhotos(partial, [first, second]);
    await saveEmbedding({ imageId: first, model, vector: vector(1, 0, 0) });
    const missing = await listProductsMissingEmbedding(model);
    expect(missing.success && missing.data).toContain(partial);
    await saveEmbedding({ imageId: second, model, vector: vector(0, 1, 0) });
    const complete = await listProductsMissingEmbedding(model);
    expect(complete.success && complete.data).not.toContain(partial);
  });
});

test("listProductsMissingEmbedding lists only active products with a current photo lacking an embedding of the model", async () => {
  const [indexed, stale, otherModelOnly, missing] = await Promise.all([1, 2, 3, 4].map(() => image(companyA)));
  const indexedId = await product(companyA, indexed);
  const staleId = await product(companyA, stale);
  const otherModelId = await product(companyA, otherModelOnly);
  const missingId = await product(companyA, missing);
  const withoutImage = await product(companyA, null);
  await withTenantIsolation(companyA, async () => {
    await saveEmbedding({ imageId: indexed, model, vector: vector(1, 0, 0) });
    await saveEmbedding({ imageId: stale, model, vector: vector(1, 0, 0) });
    await setPrimary(staleId, await image(companyA));
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
    expect(await findPhotoIndexState(productId, model)).toEqual({ success: true, data: null });
    await saveEmbedding({ imageId, model, vector: vector(0, 0, 1) });
  });
  expect((await stored(companyA)).map((row) => row.imageId)).not.toContain(imageId);
  expect(await stored(companyB)).toEqual([{ imageId, model, embedding: "[1,0,0]" }]);
});

test("hasIndexedProducts sees a product indexed only through a non-primary photo", async () => {
  const company = randomUUID();
  await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
  try {
    const [front, stand] = [await image(company), await image(company)];
    const productId = await product(company, front);
    await withTenantIsolation(company, async () => {
      await setPhotos(productId, [front, stand]);
      expect(await hasIndexedProducts(model)).toEqual({ success: true, data: false });
      await saveEmbedding({ imageId: stand, model, vector: vector(1, 0, 0) });
      expect(await hasIndexedProducts(model)).toEqual({ success: true, data: true });
    });
  } finally {
    await withTenantIsolation(company, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await prisma.company.delete({ where: { id: company } });
    });
  }
});

test("hasIndexedProducts is true only when a product of the company has a current photo embedded with the model", async () => {
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
      await setPrimary(productId, current);
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

test("findNearestProductImages returns the closest photo of each product once", async () => {
  const [near, mid, farPhoto, other] = await Promise.all([1, 2, 3, 4].map(() => image(companyA)));
  const multi = await product(companyA, near);
  const single = await product(companyA, other);
  await withTenantIsolation(companyA, async () => {
    await setPhotos(multi, [farPhoto, near, mid]);
    await saveEmbedding({ imageId: farPhoto, model: searchModel, vector: vector(0, 1, 0) });
    await saveEmbedding({ imageId: near, model: searchModel, vector: vector(1, 0, 0) });
    await saveEmbedding({ imageId: mid, model: searchModel, vector: vector(1, 1, 0) });
    await saveEmbedding({ imageId: other, model: searchModel, vector: vector(1, 0.5, 0) });
    const found = await findNearestProductImages(vector(1, 0, 0), searchModel, 50);
    expect(found.success).toBe(true);
    if (!found.success) return;
    expect(found.data.filter(({ productId }) => productId === multi)).toEqual([{ productId: multi, imageId: near, position: 1, distance: 0 }]);
    expect(found.data.filter(({ productId }) => productId === single)).toMatchObject([{ imageId: other, position: 0 }]);
    expect(new Set(found.data.map(({ productId }) => productId)).size).toBe(found.data.length);
    expect(found.data.map(({ distance }) => distance)).toEqual([...found.data.map(({ distance }) => distance)].sort((a, b) => a - b));
  });
});

test("a removed photo no longer makes its product a candidate even though its embedding stays", async () => {
  const [kept, removed] = [await image(companyB), await image(companyB)];
  const productId = await product(companyB, kept);
  await withTenantIsolation(companyB, async () => {
    await setPhotos(productId, [kept, removed]);
    await saveEmbedding({ imageId: kept, model: searchModel, vector: vector(0, 1, 0) });
    await saveEmbedding({ imageId: removed, model: searchModel, vector: vector(1, 0, 0) });
    const before = await findNearestProductImages(vector(1, 0, 0), searchModel, 50);
    expect(before.success && before.data.find((row) => row.productId === productId)).toMatchObject({ imageId: removed, position: 1 });
    await setPhotos(productId, [kept]);
    const after = await findNearestProductImages(vector(1, 0, 0), searchModel, 50);
    expect(after.success && after.data.find((row) => row.productId === productId)).toMatchObject({ imageId: kept, position: 0, distance: 1 });
    await setPhotos(productId, []);
    const none = await findNearestProductImages(vector(1, 0, 0), searchModel, 50);
    expect(none.success && none.data.map((row) => row.productId)).not.toContain(productId);
    expect(await stored(companyB)).toContainEqual(expect.objectContaining({ imageId: removed }));
  });
});

test("findNearestProductImages ignores embeddings of another model, of a replaced image and of another company", async () => {
  const replaced = await indexedSellable(companyB, [1, 0, 0]);
  await indexedSellable(companyB, [1, 0, 0], otherModel);
  const current = await indexedSellable(companyB, [0, 1, 0]);
  await indexedSellable(companyA, [1, 0, 0]);
  const newImage = await image(companyB);
  await withTenantIsolation(companyB, async () => {
    await setPrimary(replaced.productId, newImage);
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
      await seedProduct({ id: productId, name: "Shirt", qrCode: productId, photoIds: [imageId], variants: [{ attributes: { Talla: "M" }, status: "inactive" }, { attributes: { Talla: "L" }, status: "inactive" }] });
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

test("nearest images and indexed products exclude hidden products and show them again once visible", async () => {
  const company = randomUUID();
  await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
  try {
    const hiddenImage = await image(company);
    const visibleImage = await image(company);
    const hiddenId = randomUUID() as ProductId;
    const visibleId = randomUUID() as ProductId;
    await withTenantIsolation(company, async () => {
      await seedProduct({ id: hiddenId, name: "Casaca jean", qrCode: hiddenId, photoIds: [hiddenImage], hidden: true });
      await seedProduct({ id: visibleId, name: "Polo", qrCode: visibleId, photoIds: [visibleImage] });
      await saveEmbedding({ imageId: hiddenImage, model: searchModel, vector: vector(1, 0, 0) });
    });
    await withTenantIsolation(company, async () => {
      // Only the hidden product has an embedding: nothing is indexed for buyers.
      expect(await hasIndexedProducts(searchModel)).toEqual({ success: true, data: false });
      expect(await findNearestProductImages(vector(1, 0, 0), searchModel, 5)).toEqual({ success: true, data: [] });
      await saveEmbedding({ imageId: visibleImage, model: searchModel, vector: vector(0, 1, 0) });
      const nearest = await findNearestProductImages(vector(1, 0, 0), searchModel, 5);
      expect(nearest.success && nearest.data.map(({ productId }) => productId)).toEqual([visibleId]);
      await prisma.product.update({ where: { id: hiddenId }, data: { hidden: false } });
      const shown = await findNearestProductImages(vector(1, 0, 0), searchModel, 5);
      expect(shown.success && shown.data.map(({ productId }) => productId)).toEqual([hiddenId, visibleId]);
    });
  } finally {
    await withTenantIsolation(company, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await prisma.company.delete({ where: { id: company } });
    });
  }
});
