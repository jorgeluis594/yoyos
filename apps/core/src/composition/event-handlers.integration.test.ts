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
// The notice is published on the real bus in production; here a recorder says what would be published and when it fails.
const { publishNotice } = vi.hoisted(() => ({ publishNotice: vi.fn() }));
vi.mock("@core/src/composition/event-bus", () => ({ applicationEventBus: () => ({ provider: { publish: publishNotice } }) }));
vi.mock("@core/src/shared/images/infrastructure/qr-code-reader", () => ({
  readQrCodes: async ({ bytes }: { bytes: Uint8Array }) => {
    const next = scans.get(new TextDecoder().decode(bytes))?.shift();
    return next && "error" in next ? err({ code: next.error, message: "QR reader unavailable" }) : ok(next?.codes ?? []);
  } }));

import { applyChatMessage, sendChatMessageNotice } from "@core/src/composition/event-handlers";
import { createSendChatMessageNoticeHandler } from "@core/src/features/notifications/composition";
import type { PushDevice } from "@core/src/features/notifications/domain/push-device";
import { applyChatMessageHandler } from "@core/src/features/orders/composition";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

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
    await seedProduct({ id: productId, name: "Shirt", qrCode: productId, variants: [{ id: variantId, attributes: { Size: "M" }, sku: `SKU-${variantId}`, salePrice: 10, qrCode: variantId }] });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "111@lid", whatsappLid: "222@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId } });
  });
  async function photo(codes: Array<{ error: "QR_READER_UNAVAILABLE" } | { codes: string[] }>, imageState?: "missing", inChat = chatId) {
    const messageId = randomUUID();
    const imageId = randomUUID();
    scans.set(imageId, codes);
    if (imageState) images.set(imageId, imageState);
    await withTenantIsolation(companyId, async () => {
      await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } });
      await prisma.chatMessage.create({ data: { id: messageId, chatId: inChat, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
        source: "contact", type: "image", imageId, uploadedByUserId: sellerId, registeredBySessionId: "session-1", sentAt: new Date(), receivedAt: new Date() } });
    });
    return messageId;
  }
  async function otherChat() {
    const id = randomUUID();
    await withTenantIsolation(companyId, async () => {
      const contact = await prisma.contact.create({ data: { whatsappAccountId: "333@lid", whatsappLid: "444@lid" } });
      await prisma.chat.create({ data: { id, contactId: contact.id } });
    });
    return id;
  }
  return { companyId, chatId, sellerId, variantId, photo, otherChat, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      for (const table of ["chatMessageOutcome", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer", "productStock", "productVariant", "productOption", "product", "image"] as const)
        await (prisma[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

/** The registered subscription with private queue names and a fast retry policy. */
function subscription(policy: Partial<EventSubscription<AppEvents, "message_created">["policy"]> = {}) {
  const suffix = randomUUID().slice(0, 8);
  const { deadLetter } = applyChatMessage.policy;
  return { ...applyChatMessage, id: `apply-chat-message-${suffix}`,
    policy: { ...applyChatMessage.policy, retryDelaySeconds: 0, exponentialBackoff: false, retryDelayMaxSeconds: undefined, ...policy,
      deadLetter: { ...deadLetter!, id: `apply-chat-message-dlq-${suffix}`, policy: { ...deadLetter!.policy, retryDelaySeconds: 1 } } } };
}

async function withBus<T>(definition: ReturnType<typeof subscription>, test: (bus: { publish(companyId: string, messageId: string): Promise<unknown>;
  job(messageId: string): Promise<{ state: string; retry_count: number } | undefined> }) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL!;
  const producer = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition] });
  const worker = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [definition], consume: true });
  const pool = new pg.Pool({ connectionString });
  const queues = [definition.id, definition.policy.deadLetter!.id];
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
    await pool.query("DELETE FROM pgboss.job WHERE name = ANY($1)", [queues]);
    await pool.query("DELETE FROM pgboss.queue WHERE name = ANY($1)", [queues]);
    await pool.end();
  }
}

const outcomesOf = (companyId: string, messageId: string) => withTenantIsolation(companyId, async () =>
  (await prisma.chatMessageOutcome.findFirst({ where: { messageId } }))?.outcomes ?? null);

describe("message_created handler on the event bus", () => {
  it("a published message_created runs apply-chat-message with tenant isolation", async () => {
    const f = await fixture();
    const definition = subscription();
    const seen: string[] = [];
    const handler = definition.handler;
    try {
      await withBus({ ...definition, handler: async (...args) => { seen.push(getCompanyId()); return handler(...args); } }, async (bus) => {
        const messageId = await f.photo([{ codes: [f.variantId] }]);
        expect(await bus.publish(f.companyId, messageId)).toEqual(ok(undefined));
        await vi.waitFor(async () => expect(await bus.job(messageId)).toMatchObject({ state: "completed" }), { timeout: 20_000, interval: 100 });
        expect(await outcomesOf(f.companyId, messageId)).toMatchObject([{ kind: "added", variantId: f.variantId, quantity: 1, identification: { method: "qr", confidence: null } }]);
      });
      expect(seen).toEqual([f.companyId]);
      await withTenantIsolation(f.companyId, async () => {
        const created = await prisma.order.findMany({ include: { items: true, messages: true } });
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ chatId: f.chatId, sellerId: f.sellerId, items: [{ variantId: f.variantId, quantity: 1n }] });
        expect(created[0].messages).toHaveLength(1);
      });
      await withTenantIsolation(randomUUID(), async () => expect(await prisma.order.count()).toBe(0));
      expect(publishNotice).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  }, 60_000);

  it("a retryable failure is retried and the order changes once", async () => {
    const f = await fixture();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      await withBus(subscription({ retries: 1 }), async (bus) => {
        const retried = await f.photo([{ error: "QR_READER_UNAVAILABLE" }, { codes: [f.variantId] }]);
        await bus.publish(f.companyId, retried);
        await vi.waitFor(async () => expect(await bus.job(retried)).toMatchObject({ state: "completed", retry_count: 1 }), { timeout: 30_000, interval: 100 });
        expect(warn.mock.calls.map(([entry]) => entry as Record<string, unknown>).filter((entry) => entry.messageId === retried))
          .toMatchObject([{ event: "orders_chat_message_retry_scheduled", errorCode: "QR_READER_UNAVAILABLE", attempt: 1 }]);
      });
      await withTenantIsolation(f.companyId, async () => expect(await prisma.orderMessage.count()).toBe(1));
    } finally { warn.mockRestore(); await f.cleanup(); }
  }, 60_000);

  it("a permanent failure records a failed outcome, publishes its notice and completes the job", async () => {
    const f = await fixture();
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    publishNotice.mockReset().mockResolvedValue(ok(undefined));
    try {
      await withBus(subscription(), async (bus) => {
        const lost = await f.photo([], "missing");
        await bus.publish(f.companyId, lost);
        await vi.waitFor(async () => expect(await bus.job(lost)).toMatchObject({ state: "completed", retry_count: 0 }), { timeout: 30_000, interval: 100 });
        expect(await outcomesOf(f.companyId, lost)).toEqual([{ kind: "failed", errorCode: "MESSAGE_NOT_FOUND" }]);
        expect(publishNotice).toHaveBeenCalledWith("chat_message_processed", { companyId: f.companyId, messageId: lost }, expect.objectContaining({ eventId: lost }));
        expect(error.mock.calls.map(([entry]) => entry as Record<string, unknown>).filter((entry) => entry.messageId === lost))
          .toMatchObject([{ event: "orders_chat_message_failed", errorCode: "MESSAGE_NOT_FOUND", source: "permanent" }]);
      });
    } finally { error.mockRestore(); await f.cleanup(); }
  }, 60_000);

  it("apply-chat-message processes two messages of one chat in arrival order while another chat proceeds", async () => {
    const f = await fixture();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const definition = subscription({ retries: 2, retryDelaySeconds: 3 });
    const handler = definition.handler;
    const events: string[] = [];
    try {
      await withBus({ ...definition, handler: async (payload, metadata, context) => {
        const label = `${payload.messageId}#${context.attempt}`;
        events.push(`start ${label}`);
        const result = await handler(payload, metadata, context);
        events.push(`end ${label}`);
        return result;
      } }, async (bus) => {
        const elsewhereChat = await f.otherChat();
        // The reader times out twice for the first message, and the next one is already waiting behind it.
        const first = await f.photo([{ error: "QR_READER_UNAVAILABLE" }, { error: "QR_READER_UNAVAILABLE" }, { codes: [f.variantId] }]);
        const second = await f.photo([{ codes: [f.variantId] }]);
        const elsewhere = await f.photo([{ codes: [f.variantId] }], undefined, elsewhereChat);
        await bus.publish(f.companyId, first);
        await bus.publish(f.companyId, second);
        await vi.waitFor(() => expect(events).toEqual([`start ${first}#1`, `end ${first}#1`]), { timeout: 30_000, interval: 50 });
        await bus.publish(f.companyId, elsewhere);
        await vi.waitFor(async () => expect(await bus.job(second)).toMatchObject({ state: "completed" }), { timeout: 45_000, interval: 200 });
        expect(await bus.job(first)).toMatchObject({ state: "completed", retry_count: 2 });
        const own = events.filter((event) => !event.includes(elsewhere));
        expect(own).toEqual([`start ${first}#1`, `end ${first}#1`, `start ${first}#2`, `end ${first}#2`, `start ${first}#3`, `end ${first}#3`, `start ${second}#1`, `end ${second}#1`]);
        expect(events.indexOf(`end ${elsewhere}#1`)).toBeGreaterThan(-1);
        expect(events.indexOf(`end ${elsewhere}#1`)).toBeLessThan(events.indexOf(`start ${first}#2`));
        expect(await outcomesOf(f.companyId, first)).toMatchObject([{ kind: "added", variantId: f.variantId, quantity: 1 }]);
        expect(await outcomesOf(f.companyId, second)).toMatchObject([{ kind: "added", variantId: f.variantId, quantity: 1 }]);
      });
      await withTenantIsolation(f.companyId, async () => {
        const orders = await prisma.order.findMany({ include: { items: true, payments: true } });
        expect(orders).toHaveLength(2);
        expect(orders.find(({ chatId }) => chatId === f.chatId)?.items.map(({ quantity }) => quantity)).toEqual([2n]);
        expect(orders.find(({ chatId }) => chatId !== f.chatId)?.items.map(({ quantity }) => quantity)).toEqual([1n]);
        // After any message the order stays open: nothing paid, checkout not confirmed, not cancelled or completed.
        expect(orders.every((order) => !order.cancelled && order.payments.length === 0 && order.checkoutConfirmedAt === null && order.completedAt === null)).toBe(true);
      });
    } finally { warn.mockRestore(); await f.cleanup(); }
  }, 90_000);

  it("a job that exhausts its retries is released by the dead-letter handler and the next message of its chat runs", async () => {
    const f = await fixture();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    publishNotice.mockReset().mockResolvedValue(ok(undefined));
    try {
      await withBus(subscription({ retries: 1 }), async (bus) => {
        const stuck = await f.photo([{ error: "QR_READER_UNAVAILABLE" }, { error: "QR_READER_UNAVAILABLE" }]);
        const next = await f.photo([{ codes: [f.variantId] }]);
        await bus.publish(f.companyId, stuck);
        await bus.publish(f.companyId, next);
        await vi.waitFor(async () => expect(await bus.job(next)).toMatchObject({ state: "completed" }), { timeout: 45_000, interval: 200 });
        expect(await outcomesOf(f.companyId, stuck)).toEqual([{ kind: "failed", errorCode: "RETRIES_EXHAUSTED" }]);
        expect(await outcomesOf(f.companyId, next)).toMatchObject([{ kind: "added" }]);
        expect(publishNotice).toHaveBeenCalledTimes(1);
        expect(publishNotice).toHaveBeenCalledWith("chat_message_processed", { companyId: f.companyId, messageId: stuck }, expect.anything());
      });
      await withTenantIsolation(f.companyId, async () => expect(await prisma.orderMessage.count()).toBe(1));
    } finally { warn.mockRestore(); error.mockRestore(); await f.cleanup(); }
  }, 90_000);
});

describe("notice publication after the commit", () => {
  it("a crash between the commit and the publish is recovered: the re-run publishes the notice once", async () => {
    const f = await fixture();
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      const lost = await f.photo([], "missing");
      const run = (attempt: number) => withTenantIsolation(f.companyId, () => applyChatMessageHandler({ companyId: f.companyId, chatId: f.chatId, messageId: lost } as never,
        { eventId: lost, occurredAt: new Date().toISOString() }, { signal: new AbortController().signal, attempt }));
      publishNotice.mockReset().mockResolvedValueOnce(err({ code: "EVENT_BUS_UNAVAILABLE", message: "down" })).mockResolvedValue(ok(undefined));
      expect(await run(1)).toEqual(ok(undefined));
      expect(await outcomesOf(f.companyId, lost)).toEqual([{ kind: "failed", errorCode: "MESSAGE_NOT_FOUND" }]);
      expect(await run(2)).toEqual(ok(undefined));
      expect(publishNotice).toHaveBeenCalledTimes(2);
      const results = await Promise.all(publishNotice.mock.results.map(({ value }) => value));
      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(await outcomesOf(f.companyId, lost)).toEqual([{ kind: "failed", errorCode: "MESSAGE_NOT_FOUND" }]);
      await withTenantIsolation(f.companyId, async () => expect(await prisma.chatMessageOutcome.count()).toBe(1));
    } finally { error.mockRestore(); warn.mockRestore(); await f.cleanup(); }
  }, 60_000);
});

describe("notice queue outage", () => {
  it("a push provider that stays down ends the notice after its retries, sends nothing and never holds the chat", async () => {
    const f = await fixture();
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const connectionString = process.env.DATABASE_URL!;
    const suffix = randomUUID().slice(0, 8);
    const device = { id: "device-1", sessionId: "session-1", userId: "user-1", token: "ExponentPushToken[a]", platform: "ios", locale: "es" } as unknown as PushDevice;
    const attempts: number[] = [];
    const noticeDefinition = { ...sendChatMessageNotice, id: `send-chat-message-notice-${suffix}`,
      policy: { ...sendChatMessageNotice.policy, retries: 2, retryDelaySeconds: 1, exponentialBackoff: false, retryDelayMaxSeconds: undefined },
      handler: createSendChatMessageNoticeHandler({
        findDeviceForSession: async () => ok(device),
        sendPush: async () => { attempts.push(Date.now()); return err({ code: "PROVIDER_UNAVAILABLE", message: "down", retryable: true }); },
        removeDevice: async () => ok(null),
      }) };
    const producer = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [noticeDefinition] });
    const worker = createPgBossProvider<AppEvents>({ connectionString, subscriptions: [noticeDefinition], consume: true });
    const pool = new pg.Pool({ connectionString });
    try {
      await producer.start();
      await worker.start();
      expect((await worker.subscribe(noticeDefinition)).success).toBe(true);
      // The notice published after the commit goes to the real notice queue instead of the recorder.
      publishNotice.mockReset().mockImplementation((name: never, payload: never, metadata: never) => producer.publish(name, payload, metadata));
      await withBus(subscription(), async (bus) => {
        const lost = await f.photo([], "missing");
        const next = await f.photo([{ codes: [f.variantId] }]);
        await bus.publish(f.companyId, lost);
        await bus.publish(f.companyId, next);
        // The next message of the chat runs while the notice of the first is still being retried or has been dropped.
        await vi.waitFor(async () => expect(await bus.job(next)).toMatchObject({ state: "completed" }), { timeout: 45_000, interval: 200 });
        expect(await outcomesOf(f.companyId, lost)).toEqual([{ kind: "failed", errorCode: "MESSAGE_NOT_FOUND" }]);
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ state: string; retry_count: number }>("SELECT state, retry_count FROM pgboss.job WHERE name = $1 AND data->'metadata'->>'eventId' = $2", [noticeDefinition.id, lost]);
          expect(rows[0]).toMatchObject({ state: "failed", retry_count: 2 });
        }, { timeout: 45_000, interval: 200 });
      });
      expect(attempts).toHaveLength(3);
      await withTenantIsolation(f.companyId, async () => {
        // The claim was released after every failure and the final drop leaves no sent mark: the notice is lost, not half sent.
        expect(await prisma.chatMessageOutcome.count({ where: { noticeSentAt: { not: null } } })).toBe(0);
        expect(await prisma.orderMessage.count()).toBe(1);
      });
    } finally {
      await worker.stop();
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = $1", [noticeDefinition.id]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [noticeDefinition.id]);
      await pool.end();
      publishNotice.mockReset();
      error.mockRestore(); warn.mockRestore();
      await f.cleanup();
    }
  }, 120_000);
});
