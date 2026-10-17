import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "vitest";

const model = "openai/gpt-6-luna+text-embedding-3-small";

test("products:index-images publishes only for products of every company missing an embedding of the current model", async () => {
  if (!process.env.DATABASE_URL?.includes("core_test")) throw new Error("Run sh scripts/run-tests.sh integration");
  const { systemPrisma, prisma, withTenantIsolation } = await import("../src/shared/infrastructure/persistance.ts");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const run = () => execFileSync("pnpm", ["--silent", "products:index-images"], {
    cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: "test", IMAGE_EMBEDDER_MODEL: "" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const companies = [randomUUID(), randomUUID()];
  const missing = [randomUUID(), randomUUID()];
  const indexed = randomUUID();
  const published = async () => (await pool.query<{ productId: string }>(
    "SELECT data->'payload'->>'productId' AS \"productId\" FROM pgboss.job WHERE name = 'index-product-image' AND data->'payload'->>'productId' = ANY($1) ORDER BY created_on",
    [[...missing, indexed]])).rows.map(({ productId }) => productId);
  const product = (id: string, imageId?: string) => ({ id, name: "Shirt", currency: "PEN", qrCode: randomUUID(), status: "active", imageId,
    createdAt: new Date(), updatedAt: new Date() });

  try {
    for (const [index, companyId] of companies.entries()) {
      await withTenantIsolation(companyId, async () => {
        await prisma.company.create({ data: { id: companyId, name: `Indexing ${index}`, country: "PE" } });
        const imageId = randomUUID();
        await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } });
        await prisma.product.create({ data: product(missing[index], imageId) });
        await prisma.product.create({ data: product(randomUUID()) });
        if (index === 0) {
          const indexedImage = randomUUID();
          await prisma.image.create({ data: { id: indexedImage, storageKey: `images/${indexedImage}` } });
          await prisma.product.create({ data: product(indexed, indexedImage) });
          await prisma.$executeRaw`INSERT INTO "ProductImageEmbedding" ("productId", "imageId", model, embedding, "createdAt")
            VALUES (${indexed}::uuid, ${indexedImage}::uuid, ${model}, '[1,0]'::vector, now())`;
        }
      });
      await systemPrisma.user.create({ data: { id: randomUUID(), name: "Seller", email: `${randomUUID()}@yoyos.test`, companyId } });
    }

    expect(run()).toContain(model);
    expect((await published()).sort()).toEqual([...missing].sort());
    await withTenantIsolation(companies[1], async () => await prisma.$executeRaw`INSERT INTO "ProductImageEmbedding" ("productId", "imageId", model, embedding, "createdAt")
      SELECT id, "imageId", ${model}, '[1,0]'::vector, now() FROM "Product" WHERE id = ${missing[1]}::uuid`);
    run();
    expect((await published()).sort()).toEqual([...missing, missing[0]].sort());
  } finally {
    await pool.query("DELETE FROM pgboss.job WHERE name = 'index-product-image' AND data->'payload'->>'productId' = ANY($1)", [[...missing, indexed]]);
    await pool.end();
    await systemPrisma.user.deleteMany({ where: { companyId: { in: companies } } });
    for (const companyId of companies) await withTenantIsolation(companyId, async () => {
      await prisma.product.deleteMany();
      await prisma.image.deleteMany();
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
}, 120_000);
