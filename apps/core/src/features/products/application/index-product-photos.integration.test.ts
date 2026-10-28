import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import type { CompanyId } from "@shared/identity";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

// Provider and image bytes are faked; bus, tenant isolation, products composition, use case and pgvector are real.
const { embeddings } = vi.hoisted(() => {
  process.env.OPENAI_API_KEY = "test";
  return { embeddings: [] as Array<"unavailable" | "invalid" | number[]> };
});
vi.mock("@core/src/features/products/infrastructure/product-matching/local-image-embedder", () => ({
  DEFAULT_LOCAL_IMAGE_MODEL: "fake", createLocalImageEmbedder: () => ({ model: "local/fake", embedImage: async () => {
    const next = embeddings.shift() ?? [1, 0, 0];
    if (next === "invalid") return err({ code: "INVALID_EMBEDDING", message: "length" });
    return next === "unavailable" ? err({ code: "EMBEDDER_UNAVAILABLE", message: "503" }) : ok(next);
  } }),
}));
vi.mock("@core/src/shared/images/application/images", async (importOriginal) => ({ ...await importOriginal<object>(),
  readImageBytes: async () => ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }) }));

import { createPublishEvent } from "@core/src/composition/event-bus";
import { indexProductPhotos } from "@core/src/composition/event-handlers";
import { findNearestProductImages, listProductsMissingEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import { productEditing, productSaveDependencies } from "@core/src/features/products/product-editing";
import { saveProduct } from "@core/src/features/products/application/save-product";
import { productRepository } from "@core/src/features/products/infrastructure/repository";
import { deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

test("a product created with two photos is indexed by the worker for both photos and retried while the embedder is down", async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  const connectionString = process.env.DATABASE_URL!;
  const definition = { ...indexProductPhotos, id: `index-product-photos-${randomUUID().slice(0, 8)}`,
    policy: { ...indexProductPhotos.policy, retryDelaySeconds: 0, exponentialBackoff: false } };
  const producer = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition] });
  const worker = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition], consume: true });
  const pool = new pg.Pool({ connectionString });
  const companyId = randomUUID();
  const global = globalThis as typeof globalThis & { __yoyosEvents?: unknown };
  const previousBus = global.__yoyosEvents;
  const jobs = async (productId: string) => (await pool.query<{ state: string; retry_count: number }>(
    "SELECT state, retry_count FROM pgboss.job WHERE name = $1 AND data->'payload'->>'productId' = $2 ORDER BY created_on", [definition.id, productId])).rows;
  const stored = () => withTenantIsolation(companyId, async () => await
    prisma.$queryRaw<Array<{ imageId: string; model: string }>>`SELECT "imageId", model FROM "ImageEmbedding" ORDER BY "createdAt"`);
  // The editor's save, sent exactly as loaded with one field changed.
  const edit = (productId: ProductId, change: Readonly<{ name?: string; photoIds?: ImageId[] }>) => withTenantIsolation(companyId, async () => {
    const loaded = await productRepository.get(productId);
    if (!loaded.success || !loaded.data) throw new Error("product not found");
    const product = loaded.data;
    // The detail read resolves image URLs, which needs storage; the reload only has to answer.
    const deps = { ...productSaveDependencies(companyId, productId), reload: async () => ok({ product, orderedVariantIds: new Set<VariantId>(), photos: [] }) };
    return await saveProduct({ productId, structureVersion: product.structureVersion, name: product.name, description: product.description ?? null, photoIds: [...product.photoIds],
      options: [], variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku ?? null, salePrice: variant.salePrice.amount, purchasePrice: variant.purchasePrice?.amount ?? null })),
      newVariants: [], deletedVariantIds: [], ...change }, { companyId: companyId as CompanyId }, deps);
  });
  try {
    await producer.start();
    await worker.start();
    expect((await worker.subscribe(definition)).success).toBe(true);
    global.__yoyosEvents = { provider: producer, publishEvent: createPublishEvent(producer) };
    const [front, stand, back] = [randomUUID() as ImageId, randomUUID() as ImageId, randomUUID() as ImageId];
    await withTenantIsolation(companyId, async () => {
      await prisma.company.create({ data: { id: companyId, name: "Indexing", country: "PE" } });
      for (const id of [front, stand, back]) await prisma.image.create({ data: { id, storageKey: `images/${id}` } });
    });
    // The first photo's embedding fails while the embedder is down; the photo after it is still tried.
    embeddings.push("unavailable", [0, 1, 0], [0, 0, 1]);
    const created = await withTenantIsolation(companyId, () => productEditing.create({ name: "Shirt", currency: "PEN", photoIds: [front, stand], options: [], variants: [{ values: [], salePrice: 10 }] }));
    expect(created.success).toBe(true);
    const productId = (created.success ? created.data : "") as ProductId;
    await vi.waitFor(async () => expect(await jobs(productId)).toMatchObject([{ state: "completed", retry_count: 1 }]), { timeout: 20_000, interval: 100 });
    expect(new Set((await stored()).map(({ imageId }) => imageId))).toEqual(new Set([front, stand]));

    expect((await edit(productId, { name: "Shirt v2" })).success).toBe(true);
    expect(await jobs(productId)).toHaveLength(1);

    // A third photo whose embedding is permanently invalid: the job succeeds without retry and the product stays recognizable by the others.
    embeddings.push("invalid");
    expect((await edit(productId, { photoIds: [front, stand, back] })).success).toBe(true);
    await vi.waitFor(async () => expect((await jobs(productId)).map(({ state }) => state)).toEqual(["completed", "completed"]), { timeout: 20_000, interval: 100 });
    expect((await jobs(productId)).map(({ retry_count }) => retry_count)).toEqual([1, 0]);
    expect((await stored()).map(({ imageId }) => imageId)).not.toContain(back);
    await withTenantIsolation(companyId, async () => {
      expect(await listProductsMissingEmbedding("local/fake" as never)).toMatchObject({ success: true, data: [productId] });
    });

    // What products:index-images does: republish, then only the missing photo is tried and the product is identified by it.
    embeddings.push([1, 0, 0]);
    expect(await withTenantIsolation(companyId, () => createPublishEvent(producer)("product_photos_added", { companyId: companyId as CompanyId, productId }))).toMatchObject({ success: true });
    await vi.waitFor(async () => expect((await jobs(productId)).map(({ state }) => state)).toEqual(["completed", "completed", "completed"]), { timeout: 20_000, interval: 100 });
    expect(embeddings).toEqual([]);
    expect(new Set((await stored()).map(({ imageId }) => imageId))).toEqual(new Set([front, stand, back]));
    await withTenantIsolation(companyId, async () => {
      expect(await listProductsMissingEmbedding("local/fake" as never)).toEqual({ success: true, data: [] });
      expect(await findNearestProductImages([1, 0, 0] as never, "local/fake" as never, 5)).toMatchObject({ success: true, data: [{ productId, imageId: back, position: 2, distance: 0 }] });
    });
  } finally {
    global.__yoyosEvents = previousBus;
    await worker.stop();
    await producer.stop();
    await pool.query("DELETE FROM pgboss.job WHERE name = $1", [definition.id]);
    await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [definition.id]);
    await pool.end();
    await withTenantIsolation(companyId, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
}, 60_000);
