import { err, ok } from "@shared/functional";
import { createWhatsAppRuntime } from "@mobile/features/whatsapp/composition";
import { receiveMessage } from "@mobile/features/whatsapp/application/receive-message";
import { createSyncWorker } from "@mobile/features/whatsapp/application/sync-messages";
import type { MessageApi, Session, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, CoreMessageId, UserId } from "@mobile/features/whatsapp/domain/ids";
import { migrateWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";
import { createLocalSql } from "@mobile/features/whatsapp/infrastructure/local-sql";
import { openTestDatabase } from "@mobile/features/whatsapp/infrastructure/node-sqlite-database";
import { createSqliteLinkStore } from "@mobile/features/whatsapp/infrastructure/sqlite-link-store";
import { createSqliteMessageStore } from "@mobile/features/whatsapp/infrastructure/sqlite-message-store";
import type { TransportError } from "@mobile/shared/application/transport-error";

const company = "c1" as CompanyId;
const event = (deliveryId: string, n = 1) => ({
  deliveryId,
  message: { id: `wa-message:v1:m${n}`, accountId: "1@lid", chatId: "2@lid", whatsappMessageId: `W${n}`, direction: "incoming" as const, text: "hi", timestamp: 1000 },
});

async function setup(respond: MessageApi["register"] = async () => ok({ status: "stored", messageId: "core-1" as CoreMessageId })) {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  const sql = createLocalSql(database);
  const links = createSqliteLinkStore(sql, () => "link-1");
  const store = createSqliteMessageStore(sql);
  await links.start(company, "u1" as UserId, new Date(0));
  const sent: string[] = [];
  const api: MessageApi = { register: async (m) => { sent.push(m.id); return respond(m); } };
  let current: Session | null = { companyId: company, userId: "u1" as UserId, generation: 1 };
  let clock = 10_000;
  const confirmed: string[] = [];
  const worker = createSyncWorker({
    store, api, session: () => current, now: () => new Date(clock), random: () => 0.5, schedule: () => () => undefined,
  });
  const receive = receiveMessage({
    store, links, now: () => new Date(clock), wakeSync: () => undefined,
    whatsapp: { confirmMessageStored: async (id) => { confirmed.push(id); return ok(undefined); } },
  });
  const messages = async () => {
    const result = await store.listMessages(company, "2@lid" as never, { beforeArrivalSeq: null, limit: 50 });
    return result.success ? result.data : [];
  };
  return { database, receive, worker, sent, confirmed, messages, advance: (ms: number) => { clock += ms; }, setSession: (s: Session | null) => { current = s; } };
}

test("a redelivered message after a restart is stored once and sent once", async () => {
  const ctx = await setup();
  await ctx.receive(event("wa-delivery:v1:" + "a".repeat(32)));
  await ctx.receive(event("wa-delivery:v1:" + "b".repeat(32)));
  await ctx.worker.runOnce();
  await ctx.worker.runOnce();
  expect(await ctx.messages()).toHaveLength(1);
  expect(ctx.sent).toHaveLength(1);
  expect(ctx.confirmed).toHaveLength(2);
  expect((await ctx.messages())[0]?.sync).toMatchObject({ state: "synced", coreMessageId: "core-1" });
  ctx.database.close();
});

test("a message received offline is synced once the API recovers", async () => {
  let online = false;
  const ctx = await setup(async () => online ? ok({ status: "stored", messageId: "core-1" as CoreMessageId }) : err<TransportError>({ code: "NETWORK_ERROR", message: "offline" }));
  await ctx.receive(event("wa-delivery:v1:" + "a".repeat(32)));
  expect(await ctx.worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 1, rejected: 0 } });
  expect(ctx.confirmed).toHaveLength(1);
  const [offline] = await ctx.messages();
  expect(offline?.sync).toMatchObject({ state: "pending", attempts: 1 });
  online = true;
  expect(await ctx.worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 0 } });
  ctx.advance(60_000);
  expect(await ctx.worker.runOnce()).toEqual({ success: true, data: { synced: 1, retried: 0, rejected: 0 } });
  ctx.database.close();
});

test("a message rejected by core is not retried", async () => {
  const ctx = await setup(async () => err<TransportError>({ code: "API_ERROR", message: "bad", http: { status: 400, body: {} } }));
  await ctx.receive(event("wa-delivery:v1:" + "a".repeat(32)));
  expect(await ctx.worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 1 } });
  ctx.advance(10 * 60_000);
  await ctx.worker.runOnce();
  expect(ctx.sent).toHaveLength(1);
  expect((await ctx.messages())[0]?.sync).toMatchObject({ state: "rejected", code: "INVALID_INPUT" });
  ctx.database.close();
});

test("a sign-out during sync leaves the message pending for the next session", async () => {
  let ctx: Awaited<ReturnType<typeof setup>> | undefined;
  ctx = await setup(async () => { ctx?.setSession(null); return err<TransportError>({ code: "OPERATION_CANCELLED", message: "Session changed" }); });
  await ctx.receive(event("wa-delivery:v1:" + "a".repeat(32)));
  await ctx.worker.runOnce();
  expect((await ctx.messages())[0]?.sync).toMatchObject({ state: "pending", attempts: 0 });
  ctx.setSession({ companyId: company, userId: "u1" as UserId, generation: 2 });
  expect(await ctx.worker.runOnce()).toMatchObject({ success: true });
  expect(ctx.sent).toHaveLength(2);
  ctx.database.close();
});

// End to end through the composed runtime: real SQLite, real stores and the real message API over a fake transport.
const accountId = "1@lid";
const stored = { status: "stored", messageId: "00000000-0000-4000-8000-000000000001", eventId: "00000000-0000-4000-8000-000000000002", receivedAt: "2026-10-10T00:00:00.000Z" };
const serverError = () => err<TransportError>({ code: "API_ERROR", message: "boom", http: { status: 500, body: {} } });
const offline = () => err<TransportError>({ code: "NETWORK_ERROR", message: "offline" });
const deliveryId = (c: string) => "wa-delivery:v1:" + c.repeat(32);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function nativeMessage(n: number, extra: Record<string, unknown> = {}) {
  const identity = Buffer.from(JSON.stringify([accountId, "2@lid", `W${n}`])).toString("base64url");
  return { id: `wa-message:v1:${identity}`, accountId, chatId: "2@lid", whatsappMessageId: `W${n}`, direction: "incoming", timestamp: 1000, ...extra };
}

type Handler = (payload: unknown) => void;

function fakeGateway() {
  const listeners = new Map<string, Set<Handler>>();
  const confirmed: string[] = [];
  const gateway = {
    initialize: async () => ok(undefined), connect: async () => ok(undefined), disconnect: async () => ok(undefined), logout: async () => ok(undefined),
    confirmMessageStored: async (id: string) => { confirmed.push(id); return ok(undefined); },
    downloadImage: async () => ok({ uri: "file:///x", mimeType: "image/png", size: 1 }), deleteDownloadedImage: async () => ok(undefined),
    addListener: (name: string, listener: Handler) => {
      const set = listeners.get(name) ?? new Set<Handler>();
      set.add(listener);
      listeners.set(name, set);
      return { remove: () => { set.delete(listener); } };
    },
  } as unknown as WhatsAppGateway;
  return { gateway, confirmed, emit: (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload)) };
}

async function runtimeSetup(responses: (() => Awaited<ReturnType<MessageApi["register"]>> | Promise<Awaited<ReturnType<MessageApi["register"]>>>)[] | null = null) {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  const fake = fakeGateway();
  let clock = 10_000;
  let linkIds = 0;
  const timers: { ms: number; run: () => void }[] = [];
  const request = jest.fn(async (_path: string, _init?: RequestInit) => {
    const next = responses?.shift();
    return next ? next() : ok(stored);
  });
  const create = () => {
    const runtime = createWhatsAppRuntime({
      database, gateway: fake.gateway, generation: () => 1, newId: () => `link-${++linkIds}`, now: () => new Date(clock), random: () => 0.5,
      schedule: (ms, run) => { timers.push({ ms, run }); return () => undefined; },
      request: request as never,
    });
    runtime.setIdentity({ companyId: "c1", userId: "u1" });
    return runtime;
  };
  const runtime = create();
  const receive = (message: unknown, id: string) => fake.emit("messageReceived", { deliveryId: id, message });
  const messages = async (rt = runtime) => {
    const result = await rt.store.listMessages(company, "2@lid" as never, { beforeArrivalSeq: null, limit: 50 });
    return result.success ? result.data : [];
  };
  // Starts a link and its reception for the main runtime, so the gateway has a message consumer.
  const link = async () => {
    await runtime.links.start(company, "u1" as UserId, new Date(0));
    await runtime.reception.start();
  };
  return { database, runtime, create, link, fake, request, timers, receive, messages, advance: (ms: number) => { clock += ms; } };
}

test("an image with an empty caption is confirmed, rejected as invalid input and never requested", async () => {
  const ctx = await runtimeSetup();
  await ctx.link();
  const image = { reference: { messageId: "m", downloadReference: "wa-image:v1:abc" }, mimeType: "image/png", size: 10 };
  ctx.fake.emit("messageReceived", { deliveryId: deliveryId("a"), message: nativeMessage(1, { text: "", image }) });
  await settle();
  expect(ctx.fake.confirmed).toEqual([deliveryId("a")]);
  expect(ctx.request).not.toHaveBeenCalled();
  expect((await ctx.messages())[0]?.sync).toMatchObject({ state: "rejected", code: "INVALID_INPUT" });
  const pending = await ctx.runtime.store.nextPending(company, new Date(10 * 60_000 + 10_000), 20);
  expect(pending).toEqual({ success: true, data: [] });
  ctx.database.close();
});

test("a text over 64 KiB is stored, confirmed and rejected without a request", async () => {
  const ctx = await runtimeSetup();
  await ctx.link();
  ctx.receive(nativeMessage(1, { text: "a".repeat(65537) }), deliveryId("a"));
  await settle();
  expect(ctx.fake.confirmed).toHaveLength(1);
  expect(ctx.request).not.toHaveBeenCalled();
  expect((await ctx.messages())[0]?.sync).toMatchObject({ state: "rejected", code: "INVALID_INPUT" });
  expect(await ctx.runtime.sync.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 0 } });
  ctx.database.close();
});

test("two messages received together right after linking are both stored with the account claimed", async () => {
  const ctx = await runtimeSetup();
  expect(await ctx.runtime.linkAccount()).toMatchObject({ success: true });
  ctx.receive(nativeMessage(1, { text: "one" }), deliveryId("a"));
  ctx.receive(nativeMessage(2, { text: "two" }), deliveryId("b"));
  await settle();
  expect(ctx.fake.confirmed.sort()).toEqual([deliveryId("a"), deliveryId("b")]);
  expect(await ctx.messages()).toHaveLength(2);
  expect(await ctx.runtime.links.active()).toMatchObject({ success: true, data: { accountId } });
  expect(ctx.runtime.reception.status().lastError).toBeNull();
  ctx.database.close();
});

test("a retry survives a restart: a new worker schedules the remaining time and then syncs", async () => {
  const ctx = await runtimeSetup([serverError]);
  await ctx.link();
  ctx.runtime.setIdentity(null);
  ctx.receive(nativeMessage(1, { text: "hi" }), deliveryId("a"));
  await settle();
  ctx.runtime.setIdentity({ companyId: "c1", userId: "u1" });
  expect(await ctx.runtime.sync.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 1, rejected: 0 } });
  ctx.advance(500);

  const restarted = ctx.create();
  ctx.timers.length = 0;
  restarted.sync.wake();
  await settle();
  expect(ctx.timers).toHaveLength(1);
  expect(ctx.timers[0]?.ms).toBe(1500);

  ctx.advance(1500);
  ctx.timers[0]?.run();
  await settle();
  expect((await ctx.messages(restarted))[0]?.sync).toMatchObject({ state: "synced" });
  ctx.database.close();
});

test("without network only one request is made per run and the timer keeps the backoff", async () => {
  const ctx = await runtimeSetup(Array.from({ length: 5 }, () => offline));
  await ctx.link();
  ctx.runtime.setIdentity(null);
  for (const n of [1, 2, 3]) ctx.receive(nativeMessage(n, { text: `m${n}` }), deliveryId(String(n)));
  await settle();
  ctx.runtime.setIdentity({ companyId: "c1", userId: "u1" });
  ctx.timers.length = 0;
  expect(await ctx.runtime.sync.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 1, rejected: 0 } });
  expect(ctx.request).toHaveBeenCalledTimes(1);
  expect(ctx.timers.at(-1)?.ms).toBe(2000);
  ctx.database.close();
});

test("the change notification fires on save and on sync, and not on duplicates or retries", async () => {
  const ctx = await runtimeSetup([serverError]);
  await ctx.link();
  ctx.runtime.setIdentity(null);
  const changed = jest.fn();
  ctx.runtime.changes.subscribe(changed);

  ctx.receive(nativeMessage(1, { text: "hi" }), deliveryId("a"));
  await settle();
  expect(changed).toHaveBeenCalledTimes(1);

  ctx.receive(nativeMessage(1, { text: "hi" }), deliveryId("b"));
  await settle();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(ctx.fake.confirmed).toHaveLength(2);

  ctx.runtime.setIdentity({ companyId: "c1", userId: "u1" });
  await ctx.runtime.sync.runOnce();
  expect(changed).toHaveBeenCalledTimes(1);

  ctx.advance(60_000);
  await ctx.runtime.sync.runOnce();
  expect(changed).toHaveBeenCalledTimes(2);
  ctx.database.close();
});
