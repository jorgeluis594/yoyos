import { err, ok } from "@shared/functional";
import { receiveMessage } from "@mobile/features/whatsapp/application/receive-message";
import { createSyncWorker } from "@mobile/features/whatsapp/application/sync-messages";
import type { MessageApi, Session } from "@mobile/features/whatsapp/application/ports";
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
