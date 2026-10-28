import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "vitest";

// The default embedder (local) needs no download to publish: the model loads only when the worker embeds.
const model = "local/onnx-community/siglip2-base-patch16-224-ONNX";

test("products:index-images publishes only for products of every company with a photo missing an embedding of the current model", async () => {
  if (!process.env.DATABASE_URL?.includes("core_test")) throw new Error("Run sh scripts/run-tests.sh integration");
  const { systemPrisma, prisma, withTenantIsolation } = await import("../src/shared/infrastructure/persistance.ts");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const run = () => execFileSync("pnpm", ["--silent", "products:index-images"], {
    cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: "test", IMAGE_EMBEDDER_PROVIDER: "", IMAGE_EMBEDDER_MODEL: "" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const companies = [randomUUID(), randomUUID()];
  const missing = [randomUUID(), randomUUID()];
  const indexed = randomUUID();
  const partial = randomUUID(); // two photos, only the first embedded
  const published = async () => (await pool.query<{ productId: string }>(
    "SELECT data->'payload'->>'productId' AS \"productId\" FROM pgboss.job WHERE name = 'index-product-photos' AND data->'payload'->>'productId' = ANY($1) ORDER BY created_on",
    [[...missing, indexed, partial]])).rows.map(({ productId }) => productId);
  const product = (id: string) => ({ id, name: "Shirt", currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date() });
  const withPhoto = async (id: string, imageId: string) => {
    await prisma.product.create({ data: product(id) });
    await prisma.productPhoto.create({ data: { productId: id, imageId, position: 0 } });
  };

  try {
    for (const [index, companyId] of companies.entries()) {
      await withTenantIsolation(companyId, async () => {
        await prisma.company.create({ data: { id: companyId, name: `Indexing ${index}`, country: "PE" } });
        const imageId = randomUUID();
        await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } });
        await withPhoto(missing[index], imageId);
        await prisma.product.create({ data: product(randomUUID()) });
        if (index === 0) {
          const indexedImage = randomUUID();
          await prisma.image.create({ data: { id: indexedImage, storageKey: `images/${indexedImage}` } });
          await withPhoto(indexed, indexedImage);
          await prisma.$executeRaw`INSERT INTO "ImageEmbedding" ("imageId", model, embedding, "createdAt")
            VALUES (${indexedImage}::uuid, ${model}, '[1,0]'::vector, now())`;
          const partialFirst = randomUUID();
          const partialSecond = randomUUID();
          for (const id of [partialFirst, partialSecond]) await prisma.image.create({ data: { id, storageKey: `images/${id}` } });
          await prisma.product.create({ data: product(partial) });
          await prisma.productPhoto.createMany({ data: [{ productId: partial, imageId: partialFirst, position: 0 }, { productId: partial, imageId: partialSecond, position: 1 }] });
          await prisma.$executeRaw`INSERT INTO "ImageEmbedding" ("imageId", model, embedding, "createdAt")
            VALUES (${partialFirst}::uuid, ${model}, '[1,0]'::vector, now())`;
        }
      });
      await systemPrisma.user.create({ data: { id: randomUUID(), name: "Seller", email: `${randomUUID()}@yoyos.test`, companyId } });
    }

    expect(run()).toContain(model);
    expect((await published()).sort()).toEqual([...missing, partial].sort());
    await withTenantIsolation(companies[1], async () => await prisma.$executeRaw`INSERT INTO "ImageEmbedding" ("imageId", model, embedding, "createdAt")
      SELECT "imageId", ${model}, '[1,0]'::vector, now() FROM "ProductPhoto" WHERE "productId" = ${missing[1]}::uuid`);
    run();
    expect((await published()).sort()).toEqual([...missing, partial, missing[0], partial].sort());
  } finally {
    await pool.query("DELETE FROM pgboss.job WHERE name = 'index-product-photos' AND data->'payload'->>'productId' = ANY($1)", [[...missing, indexed, partial]]);
    await pool.end();
    await systemPrisma.user.deleteMany({ where: { companyId: { in: companies } } });
    for (const companyId of companies) await withTenantIsolation(companyId, async () => {
      await prisma.product.deleteMany();
      await prisma.image.deleteMany();
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
}, 120_000);
