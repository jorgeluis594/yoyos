import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";

const model = "openai/test" as EmbeddingModel;
const vector = (...values: number[]) => values as unknown as EmbeddingVector;

/** Seeds active products with one variant and an embedding of their current image per company. */
async function withEmbeddings(run: (ctx: Awaited<ReturnType<typeof seedContext>>) => Promise<void>) {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  const ctx = await seedContext();
  try { await run(ctx); }
  finally {
    for (const id of [ctx.companyA, ctx.companyB]) await ctx.withTenantIsolation(id, async () => {
      await ctx.prisma.productVariant.deleteMany({ where: { companyId: id } });
      await ctx.prisma.product.deleteMany({ where: { companyId: id } });
      await ctx.prisma.image.deleteMany({ where: { companyId: id } });
      await ctx.prisma.company.deleteMany({ where: { id } });
    });
  }
}

async function seedContext() {
  const { prisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
  const { findNearestProductImages } = await import("@core/src/features/products/infrastructure/product-image-embeddings");
  const companyA = randomUUID();
  const companyB = randomUUID();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
  const product = (companyId: string, embedding: readonly number[], embeddingModel: string = model) => withTenantIsolation(companyId, async () => {
    const productId = randomUUID();
    const imageId = randomUUID();
    await prisma.image.create({ data: { id: imageId, storageKey: imageId } });
    await prisma.product.create({ data: { id: productId, name: "Polo", currency: "PEN", qrCode: randomUUID(), imageId, status: "active", createdAt: new Date(), updatedAt: new Date() } });
    await prisma.productVariant.create({ data: { id: randomUUID(), productId, qrCode: randomUUID(), attributes: {}, sku: null, salePrice: 10, status: "active" } });
    await prisma.$executeRaw`INSERT INTO "ProductImageEmbedding" ("productId", "imageId", model, embedding, "createdAt")
      VALUES (${productId}::uuid, ${imageId}::uuid, ${embeddingModel}, ${`[${embedding.join(",")}]`}::vector, now())`;
    return { productId, imageId };
  });
  return { prisma, withTenantIsolation, findNearestProductImages, companyA, companyB, product };
}

test("findNearestProductImages returns the closest products of the company ordered by distance", () => withEmbeddings(async ({ companyA, product, withTenantIsolation, findNearestProductImages }) => {
  const far = await product(companyA, [0, 1, 0]);
  const close = await product(companyA, [1, 0.1, 0]);
  const exact = await product(companyA, [1, 0, 0]);
  await withTenantIsolation(companyA, async () => {
    const found = await findNearestProductImages(vector(1, 0, 0), model, 2);
    expect(found).toMatchObject({ success: true, data: [{ productId: exact.productId, imageId: exact.imageId, distance: 0 }, { productId: close.productId, imageId: close.imageId }] });
    expect(found.success && found.data.map(({ productId }) => productId)).not.toContain(far.productId);
  });
}));

test("findNearestProductImages ignores embeddings of another model, of a replaced image and of another company", () => withEmbeddings(async ({ companyA, companyB, product, prisma, withTenantIsolation, findNearestProductImages }) => {
  const current = await product(companyA, [0, 1, 0]);
  await product(companyA, [1, 0, 0], "openai/other");
  const replaced = await product(companyA, [1, 0, 0]);
  await product(companyB, [1, 0, 0]);
  await withTenantIsolation(companyA, async () => {
    const newImage = randomUUID();
    await prisma.image.create({ data: { id: newImage, storageKey: newImage } });
    await prisma.product.update({ where: { id: replaced.productId }, data: { imageId: newImage } });
    const found = await findNearestProductImages(vector(1, 0, 0), model, 5);
    expect(found.success && found.data.map(({ productId }) => productId)).toEqual([current.productId]);
  });
}));
