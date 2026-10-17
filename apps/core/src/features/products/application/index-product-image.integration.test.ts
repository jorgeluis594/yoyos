import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

// Provider and image bytes are faked; bus, tenant isolation, products composition, use case and pgvector are real.
const { embeddings } = vi.hoisted(() => {
  process.env.OPENAI_API_KEY = "test";
  return { embeddings: [] as Array<"unavailable" | number[]> };
});
vi.mock("@core/src/features/products/infrastructure/product-matching/openai-image-embedder", () => ({
  createOpenAiImageEmbedder: () => ({ model: "openai/fake+text-embedding-3-small", embedImage: async () => {
    const next = embeddings.shift() ?? [1, 0, 0];
    return next === "unavailable" ? err({ code: "EMBEDDER_UNAVAILABLE", message: "503" }) : ok(next);
  } }),
}));
vi.mock("@core/src/shared/images/application/images", async (importOriginal) => ({ ...await importOriginal<object>(),
  readImageBytes: async () => ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }) }));

import { createPublishEvent } from "@core/src/composition/event-bus";
import { indexProductImage } from "@core/src/composition/event-handlers";
import { products } from "@core/src/features/products/composition";

test("a product created with an image is indexed by the worker, reindexed on image change and retried while the embedder is down", async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  const connectionString = process.env.DATABASE_URL!;
  const definition = { ...indexProductImage, id: `index-product-image-${randomUUID().slice(0, 8)}`,
    policy: { ...indexProductImage.policy, retryDelaySeconds: 0, exponentialBackoff: false } };
  const producer = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition] });
  const worker = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition], consume: true });
  const pool = new pg.Pool({ connectionString });
  const companyId = randomUUID();
  const global = globalThis as typeof globalThis & { __yoyosEvents?: unknown };
  const previousBus = global.__yoyosEvents;
  const jobs = async (productId: string) => (await pool.query<{ state: string; retry_count: number }>(
    "SELECT state, retry_count FROM pgboss.job WHERE name = $1 AND data->'payload'->>'productId' = $2 ORDER BY created_on", [definition.id, productId])).rows;
  const stored = () => withTenantIsolation(companyId, async () => await
    prisma.$queryRaw<Array<{ imageId: string; model: string }>>`SELECT "imageId", model FROM "ProductImageEmbedding"`);
  try {
    await producer.start();
    await worker.start();
    expect((await worker.subscribe(definition)).success).toBe(true);
    global.__yoyosEvents = { provider: producer, publishEvent: createPublishEvent(producer) };
    const [first, second] = [randomUUID() as ImageId, randomUUID() as ImageId];
    await withTenantIsolation(companyId, async () => {
      await prisma.company.create({ data: { id: companyId, name: "Indexing", country: "PE" } });
      for (const id of [first, second]) await prisma.image.create({ data: { id, storageKey: `images/${id}` } });
    });
    embeddings.push("unavailable", [1, 0, 0]);
    const created = await withTenantIsolation(companyId, () => products.create({ name: "Shirt", currency: "PEN", imageId: first, variants: [{ attributes: {}, salePrice: 10 }] }));
    expect(created.success).toBe(true);
    const productId = (created.success ? created.data : "") as ProductId;
    await vi.waitFor(async () => expect(await jobs(productId)).toMatchObject([{ state: "completed", retry_count: 1 }]), { timeout: 20_000, interval: 100 });
    expect(await stored()).toEqual([{ imageId: first, model: "openai/fake+text-embedding-3-small" }]);

    expect((await withTenantIsolation(companyId, () => products.update(productId, { name: "Shirt v2" }))).success).toBe(true);
    expect(await jobs(productId)).toHaveLength(1);

    expect((await withTenantIsolation(companyId, () => products.update(productId, { imageId: second }))).success).toBe(true);
    await vi.waitFor(async () => expect((await jobs(productId)).map(({ state }) => state)).toEqual(["completed", "completed"]), { timeout: 20_000, interval: 100 });
    expect(await stored()).toEqual([{ imageId: second, model: "openai/fake+text-embedding-3-small" }]);
  } finally {
    global.__yoyosEvents = previousBus;
    await worker.stop();
    await producer.stop();
    await pool.query("DELETE FROM pgboss.job WHERE name = $1", [definition.id]);
    await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [definition.id]);
    await pool.end();
    await withTenantIsolation(companyId, async () => {
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await prisma.image.deleteMany();
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
}, 60_000);
