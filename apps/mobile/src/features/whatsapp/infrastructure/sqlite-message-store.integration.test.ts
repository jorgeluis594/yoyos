import { createSqliteMessageStore } from "@mobile/features/whatsapp/infrastructure/sqlite-message-store";
import { createSqliteLinkStore } from "@mobile/features/whatsapp/infrastructure/sqlite-link-store";
import { createLocalSql } from "@mobile/features/whatsapp/infrastructure/local-sql";
import { migrateWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";
import { openTestDatabase } from "@mobile/features/whatsapp/infrastructure/node-sqlite-database";
import type { CompanyId, CoreMessageId, ImageDownloadReference, NativeMessageId, UserId, WhatsAppChatId } from "@mobile/features/whatsapp/domain/ids";
import type { InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import type { Placement } from "@mobile/features/whatsapp/application/ports";

const company = "company-1" as CompanyId;
const otherCompany = "company-2" as CompanyId;

function text(n: number, chat = "2@lid", sentAt: Date | null = new Date(1000 * n)): InboundMessage {
  return {
    id: `wa-message:v1:m${n}` as NativeMessageId, accountId: "1@lid" as never, chatId: chat as never,
    whatsappMessageId: `W${n}` as never, direction: "incoming", sentAt, content: { type: "text", text: `hello ${n}` },
  };
}
const image = (n: number): InboundMessage => ({
  ...text(n), content: { type: "image", caption: null, mimeType: "image/jpeg", size: 5, reference: "wa-image:v1:secret" as ImageDownloadReference },
});

async function setup() {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  const sql = createLocalSql(database);
  let counter = 0;
  const links = createSqliteLinkStore(sql, () => `link-${++counter}`);
  const store = createSqliteMessageStore(sql);
  const start = async (companyId: CompanyId) => {
    const started = await links.start(companyId, "u" as UserId, new Date(0));
    if (!started.success) throw new Error("link not started");
    return started.data;
  };
  const linked = async (companyId = company, claim = false): Promise<Placement> =>
    ({ kind: "linked", link: await start(companyId), claim });
  return { database, store, links, linked };
}

const now = new Date(10_000);

test("saveOnce stores a new message and returns stored", async () => {
  const { database, store, linked } = await setup();
  const result = await store.saveOnce(text(1), await linked(company, true), now);
  expect(result).toMatchObject({ success: true, data: { status: "stored", message: {
    id: text(1).id, companyId: company, arrivalSeq: 1, storedAt: now, content: { type: "text", text: "hello 1" },
    sync: { state: "pending", attempts: 0, nextAttemptAt: now },
  } } });
  database.close();
});

test("saveOnce returns duplicate with the original row and keeps its sync state", async () => {
  const { database, store, linked } = await setup();
  const placement = await linked();
  await store.saveOnce(text(1), placement, now);
  await store.markSynced(text(1).id, "core-1" as CoreMessageId, new Date(20_000));
  const again = await store.saveOnce(text(1), { kind: "orphan" }, new Date(30_000));
  expect(again).toMatchObject({ success: true, data: { status: "duplicate", message: { arrivalSeq: 1, storedAt: now, sync: { state: "synced", coreMessageId: "core-1" } } } });
  database.close();
});

test("saveOnce claims the link and inserts the message in one transaction", async () => {
  const { database, store, links, linked } = await setup();
  await store.saveOnce(text(1), await linked(company, true), now);
  expect(await links.active()).toMatchObject({ data: { accountId: "1@lid" } });
  database.close();
});

test("saveOnce leaves the link unclaimed when the insert fails", async () => {
  const { database, store, links, linked } = await setup();
  const placement = await linked(company, true);
  const broken = { ...text(1), content: { type: "text", text: null as never } } as InboundMessage;
  expect(await store.saveOnce(broken, placement, now)).toMatchObject({ success: false, error: { code: "LOCAL_STORAGE_FAILED" } });
  expect(await links.active()).toMatchObject({ data: { accountId: null } });
  expect(await store.saveOnce(text(1), placement, now)).toMatchObject({ success: true, data: { status: "stored" } });
  database.close();
});

test("assigns increasing arrival sequences", async () => {
  const { database, store, linked } = await setup();
  const placement = await linked();
  const seqs = [];
  for (const n of [3, 1, 2]) {
    const result = await store.saveOnce(text(n), placement, now);
    seqs.push(result.success ? result.data.message.arrivalSeq : -1);
  }
  expect(seqs).toEqual([1, 2, 3]);
  database.close();
});

test("rejects text rows without text and image rows without reference", async () => {
  const { database, store, linked } = await setup();
  const placement = await linked();
  expect(await store.saveOnce({ ...text(1), content: { type: "text", text: null as never } }, placement, now)).toMatchObject({ success: false });
  const noReference = { ...image(2), content: { ...image(2).content, reference: null as never } } as InboundMessage;
  expect(await store.saveOnce(noReference, placement, now)).toMatchObject({ success: false });
  database.close();
});

test("rejects orphaned rows with a link, synced rows without core id and links without company", async () => {
  const { database, store, linked } = await setup();
  await store.saveOnce(text(1), await linked(), now);
  const run = (sql: string) => database.runAsync(sql, []);
  await expect(run("UPDATE whatsapp_messages SET sync_state = 'orphaned'")).rejects.toThrow();
  await expect(run("UPDATE whatsapp_messages SET sync_state = 'synced'")).rejects.toThrow();
  await expect(run("UPDATE whatsapp_messages SET company_id = NULL")).rejects.toThrow();
  database.close();
});

test("stores an orphan without link or company and never offers it for sync", async () => {
  const { database, store } = await setup();
  const saved = await store.saveOnce(text(1), { kind: "orphan" }, now);
  expect(saved).toMatchObject({ success: true, data: { message: { linkId: null, companyId: null, sync: { state: "orphaned" } } } });
  expect(await store.nextPending(company, new Date(99_999), 10)).toEqual({ success: true, data: [] });
  database.close();
});

test("nextPending returns due pending messages of the company in arrival order up to the limit", async () => {
  const { database, store, linked } = await setup();
  const mine = await linked();
  const theirs = await linked(otherCompany).catch(() => null);
  expect(theirs).toBeNull(); // only one active link per installation
  for (const n of [1, 2, 3, 4]) await store.saveOnce(text(n), mine, now);
  await store.saveOnce({ ...text(5), accountId: "9@lid" as never }, { kind: "orphan" }, now);
  await store.markRetry(text(2).id, 1, new Date(50_000));
  await store.markSynced(text(3).id, "c" as CoreMessageId, now);
  const due = await store.nextPending(company, new Date(20_000), 10);
  expect(due.success && due.data.map((m) => m.id)).toEqual([text(1).id, text(4).id]);
  const limited = await store.nextPending(company, new Date(60_000), 2);
  expect(limited.success && limited.data.map((m) => m.id)).toEqual([text(1).id, text(2).id]);
  expect(await store.nextPending(otherCompany, new Date(60_000), 10)).toEqual({ success: true, data: [] });
  database.close();
});

test("markSynced does not overwrite a terminal state", async () => {
  const { database, store, linked } = await setup();
  await store.saveOnce(text(1), await linked(), now);
  await store.markRejected(text(1).id, "INVALID_INPUT", new Date(2));
  await store.markSynced(text(1).id, "core" as CoreMessageId, new Date(3));
  const rows = await store.listMessages(company, "2@lid" as WhatsAppChatId, { beforeArrivalSeq: null, limit: 5 });
  expect(rows).toMatchObject({ data: [{ sync: { state: "rejected", code: "INVALID_INPUT", at: new Date(2) } }] });
  database.close();
});

test("markRetry and markRejected persist attempts, next attempt and error code", async () => {
  const { database, store, linked } = await setup();
  const placement = await linked();
  await store.saveOnce(text(1), placement, now);
  await store.saveOnce(text(2), placement, now);
  await store.markRetry(text(1).id, 3, new Date(77_000));
  await store.markRejected(text(2).id, "PAYLOAD_TOO_LARGE", new Date(5));
  const rows = await store.listMessages(company, "2@lid" as WhatsAppChatId, { beforeArrivalSeq: null, limit: 5 });
  expect(rows).toMatchObject({ data: [
    { id: text(2).id, sync: { state: "rejected", code: "PAYLOAD_TOO_LARGE" } },
    { id: text(1).id, sync: { state: "pending", attempts: 3, nextAttemptAt: new Date(77_000) } },
  ] });
  database.close();
});

test("listConversations groups by chat for the company with last message, count and unsynced", async () => {
  const { database, store, linked } = await setup();
  const placement = await linked();
  await store.saveOnce(text(1, "2@lid"), placement, now);
  await store.saveOnce(text(2, "3@lid", null), placement, now);
  await store.saveOnce(image(3), placement, now);
  await store.markSynced(text(1).id, "c" as CoreMessageId, now);
  const result = await store.listConversations(company);
  expect(result).toEqual({ success: true, data: [
    { chatId: "2@lid", lastMessage: { preview: null, type: "image", sentAt: new Date(3000), direction: "incoming" }, messageCount: 2, unsynced: 1 },
    { chatId: "3@lid", lastMessage: { preview: "hello 2", type: "text", sentAt: null, direction: "incoming" }, messageCount: 1, unsynced: 1 },
  ] });
  expect(await store.listConversations(otherCompany)).toEqual({ success: true, data: [] });
  database.close();
});

test("listMessages pages by arrival sequence and ignores other companies", async () => {
  const { database, store, linked } = await setup();
  const placement = await linked();
  for (const n of [1, 2, 3, 4]) await store.saveOnce(text(n), placement, now);
  const first = await store.listMessages(company, "2@lid" as WhatsAppChatId, { beforeArrivalSeq: null, limit: 2 });
  expect(first.success && first.data.map((m) => m.arrivalSeq)).toEqual([4, 3]);
  const second = await store.listMessages(company, "2@lid" as WhatsAppChatId, { beforeArrivalSeq: 3, limit: 5 });
  expect(second.success && second.data.map((m) => m.arrivalSeq)).toEqual([2, 1]);
  expect(await store.listMessages(otherCompany, "2@lid" as WhatsAppChatId, { beforeArrivalSeq: null, limit: 5 })).toEqual({ success: true, data: [] });
  database.close();
});

test("findImage returns the reference for the company and null otherwise", async () => {
  const { database, store, linked } = await setup();
  const placement = await linked();
  await store.saveOnce(image(1), placement, now);
  await store.saveOnce(text(2), placement, now);
  expect(await store.findImage(company, image(1).id)).toEqual({ success: true, data: { messageId: image(1).id, reference: "wa-image:v1:secret" } });
  expect(await store.findImage(otherCompany, image(1).id)).toEqual({ success: true, data: null });
  expect(await store.findImage(company, text(2).id)).toEqual({ success: true, data: null });
  database.close();
});

test("translates SQLite failures into LOCAL_STORAGE_FAILED without the original data", async () => {
  const { database, store } = await setup();
  database.close();
  const result = await store.nextPending(company, now, 1);
  expect(result).toEqual({ success: false, error: { code: "LOCAL_STORAGE_FAILED", message: "Local storage failed" } });
});
