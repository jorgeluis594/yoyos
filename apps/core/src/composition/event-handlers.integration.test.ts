import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import type { EventSubscription } from "@core/src/shared/events/application/contracts";

// Image bytes and QR decoding are faked by image id; everything else (bus, tenant isolation, use case, repositories) is real.
const { images, scans } = vi.hoisted(() => ({
  images: new Map<string, "missing">(),
  scans: new Map<string, Array<{ error: "QR_READER_UNAVAILABLE" } | { codes: string[] }>>(),
}));
vi.mock("@core/src/shared/images", async (importOriginal) => ({ ...await importOriginal<object>(),
  readImageBytes: async (imageId: string) => images.get(imageId) === "missing"
    ? { success: false, error: { code: "IMAGE_NOT_FOUND", message: "Image is not available" } }
    : { success: true, data: { bytes: new TextEncoder().encode(imageId), contentType: "image/jpeg" } } }));
vi.mock("@core/src/features/products/infrastructure/qr-code-reader", () => ({
  readQrCodes: async ({ bytes }: { bytes: Uint8Array }) => {
    const next = scans.get(new TextDecoder().decode(bytes))?.shift();
    return next && "error" in next ? err({ code: next.error, message: "QR reader unavailable" }) : ok(next?.codes ?? []);
  } }));

import { addMessageProductsToOrder } from "@core/src/composition/event-handlers";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const contactId = randomUUID();
  const chatId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Handler orders", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    await prisma.product.create({ data: { id: productId, name: "Shirt", currency: "PEN", qrCode: productId, status: "active", createdAt: new Date(), updatedAt: new Date() } });
    await prisma.productVariant.create({ data: { id: variantId, productId, attributes: { Size: "M" }, sku: `SKU-${variantId}`, salePrice: 10, qrCode: variantId, status: "active" } });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "111@lid", whatsappLid: "222@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId } });
  });
  async function photo(codes: Array<{ error: "QR_READER_UNAVAILABLE" } | { codes: string[] }>, imageState?: "missing") {
    const messageId = randomUUID();
    const imageId = randomUUID();
    scans.set(imageId, codes);
    if (imageState) images.set(imageId, imageState);
    await withTenantIsolation(companyId, async () => {
      await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } });
      await prisma.chatMessage.create({ data: { id: messageId, chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
        source: "contact", type: "image", imageId, uploadedByUserId: sellerId, sentAt: new Date(), receivedAt: new Date() } });
    });
    return messageId;
  }
  return { companyId, chatId, sellerId, variantId, photo, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      for (const table of ["orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer", "productVariant", "product", "image"] as const)
        await (prisma[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

/** The registered subscription with a private queue name and a fast retry policy. */
function subscription(policy: Partial<EventSubscription<AppEvents, "message_created">["policy"]> = {}) {
  return { ...addMessageProductsToOrder, id: `add-message-products-${randomUUID().slice(0, 8)}`,
    policy: { ...addMessageProductsToOrder.policy, retryDelaySeconds: 0, exponentialBackoff: false, ...policy } };
}

async function withBus<T>(definition: ReturnType<typeof subscription>, test: (bus: { publish(companyId: string, messageId: string): Promise<unknown>;
  job(messageId: string): Promise<{ state: string; retry_count: number } | undefined> }) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL!;
  const producer = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition] });
  const worker = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition], consume: true });
  const pool = new pg.Pool({ connectionString });
  try {
    await producer.start();
    await worker.start();
    expect((await worker.subscribe(definition)).success).toBe(true);
    return await test({
      publish: (companyId, messageId) => withTenantIsolation(companyId, async () => {
        const { chatId } = await prisma.chatMessage.findFirstOrThrow({ where: { id: messageId }, select: { chatId: true } });
        return producer.publish("message_created", { companyId, chatId, messageId } as never, { eventId: messageId, occurredAt: new Date().toISOString() });
      }),
      job: async (messageId) => (await pool.query<{ state: string; retry_count: number }>(
        "SELECT state, retry_count FROM pgboss.job WHERE name = $1 AND data->'metadata'->>'eventId' = $2", [definition.id, messageId])).rows[0],
    });
  } finally {
    await worker.stop();
    await producer.stop();
    await pool.query("DELETE FROM pgboss.job WHERE name = $1", [definition.id]);
    await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [definition.id]);
    await pool.end();
  }
}

describe("message_created handler on the event bus", () => {
  it("a published message_created runs add-message-products-to-order with tenant isolation", async () => {
    const f = await fixture();
    const definition = subscription();
    const seen: string[] = [];
    const handler = definition.handler;
    try {
      await withBus({ ...definition, handler: async (...args) => { seen.push(getCompanyId()); return handler(...args); } }, async (bus) => {
        const messageId = await f.photo([{ codes: [f.variantId] }]);
        expect(await bus.publish(f.companyId, messageId)).toEqual(ok(undefined));
        await vi.waitFor(async () => expect(await bus.job(messageId)).toMatchObject({ state: "completed" }), { timeout: 20_000, interval: 100 });
      });
      expect(seen).toEqual([f.companyId]);
      await withTenantIsolation(f.companyId, async () => {
        const created = await prisma.order.findMany({ include: { items: true, messages: true } });
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ chatId: f.chatId, sellerId: f.sellerId, items: [{ variantId: f.variantId, quantity: 1n }] });
        expect(created[0].messages).toHaveLength(1);
      });
      await withTenantIsolation(randomUUID(), async () => expect(await prisma.order.count()).toBe(0));
    } finally { await f.cleanup(); }
  }, 60_000);

  it("a retryable failure is retried and a permanent failure leaves the job failed", async () => {
    const f = await fixture();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    try {
      await withBus(subscription({ retries: 1 }), async (bus) => {
        const retried = await f.photo([{ error: "QR_READER_UNAVAILABLE" }, { codes: [f.variantId] }]);
        const permanent = await f.photo([], "missing");
        await bus.publish(f.companyId, retried);
        await bus.publish(f.companyId, permanent);
        await vi.waitFor(async () => {
          expect(await bus.job(retried)).toMatchObject({ state: "completed", retry_count: 1 });
          expect(await bus.job(permanent)).toMatchObject({ state: "failed", retry_count: 0 });
        }, { timeout: 30_000, interval: 100 });
        const fields = (spy: typeof warn, messageId: string) => spy.mock.calls.map(([entry]) => entry as Record<string, unknown>).filter((entry) => entry.messageId === messageId);
        expect(fields(warn, retried)).toMatchObject([{ event: "orders_message_order_failed", code: "QR_READER_UNAVAILABLE", retryable: true, attempt: 1 }]);
        expect(fields(error, permanent)).toMatchObject([{ event: "orders_message_order_failed", code: "IMAGE_NOT_FOUND", retryable: false, attempt: 1 }]);
      });
      await withTenantIsolation(f.companyId, async () => expect(await prisma.orderMessage.count()).toBe(1));
    } finally { warn.mockRestore(); error.mockRestore(); await f.cleanup(); }
  }, 60_000);
});
