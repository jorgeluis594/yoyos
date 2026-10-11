import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import pg from "pg";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { parseMobileMessage } from "@core/src/features/chats/presentation/mobile-message-schemas";
import { storeOnce } from "@core/src/features/chats/store-mobile-message";
import type { NewMobileMessage } from "@core/src/features/chats/domain/mobile-message";

const nativeId = (accountId: string, chatId: string, protocolId: string) => `wa-message:v1:${Buffer.from(JSON.stringify([accountId, chatId, protocolId])).toString("base64url")}`;
const accountId = "123@lid";
const remoteChatId = "456@lid";
type DatedMessage = NewMobileMessage & { sentAt: Date };
function message(companyId: string, protocolId: string, content: object, direction: "incoming" | "outgoing" = "incoming", uploader = "test-user", externalId = nativeId(accountId, remoteChatId, protocolId)): DatedMessage {
  const parsed = parseMobileMessage({ version: 1, message: { id: externalId, accountId, chatId: remoteChatId, whatsappMessageId: protocolId,
    direction, timestamp: 1791417600123, content } });
  expect(parsed).not.toBeNull();
  return { ...parsed!, sentAt: parsed!.sentAt as Date, companyId: companyId as NewMobileMessage["companyId"], uploadedByUserId: uploader,
    id: randomUUID() as NewMobileMessage["id"], receivedAt: new Date("2026-10-08T12:00:00.456Z") };
}
async function fixture() {
  const companyId = randomUUID();
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Mobile messages", country: "PE" } }));
  return { companyId, cleanup: () => withTenantIsolation(companyId, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId } });
    await prisma.chat.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  }) };
}

test("stores and reads both directions and content variants without media side effects", async () => {
  const f = await fixture();
  try {
    const cases = [
      { type: "text", text: "Hola 👋" },
      { type: "image" },
      { type: "image", caption: "Foto 📷", mimeType: "image/png", size: Number.MAX_SAFE_INTEGER },
    ];
    for (const direction of ["incoming", "outgoing"] as const) for (const [index, content] of cases.entries()) {
      const input = message(f.companyId, `p-${direction}-${index}`, content, direction);
      const result = await storeOnce(input);
      expect(result).toMatchObject({ success: true, data: { created: true, message: { id: input.id, externalId: input.externalId,
        companyId: f.companyId, direction, sentAt: input.sentAt, receivedAt: input.receivedAt, uploadedByUserId: "test-user" } } });
      if (result.success) expect(result.data.message.content).toEqual({ type: content.type,
        ...(content.type === "text" ? { text: "Hola 👋" } : { caption: "caption" in content ? content.caption : null,
          mimeType: "mimeType" in content ? content.mimeType : null, size: "size" in content ? content.size : null }) });
    }
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.contact.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chat.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chatMessage.count({ where: { companyId: f.companyId } })).toBe(6);
      expect(await prisma.image.count({ where: { companyId: f.companyId } })).toBe(0);
      const rows = await prisma.chatMessage.findMany({ where: { companyId: f.companyId } });
      expect(rows.every((row) => row.userId === null && row.source === (row.direction === "incoming" ? "contact" : "seller"))).toBe(true);
      expect(rows.filter((row) => row.type === "image").every((row) => row.imageStatus === "metadata_only" && row.whatsappMediaId === null && row.imageId === null)).toBe(true);
    });
  } finally { await f.cleanup(); }
});

test("a failed message insert rolls back its new contact and chat", async () => {
  const f = await fixture();
  try {
    const input = message(f.companyId, "rollback", { type: "text", text: "failure" });
    const failed = await storeOnce({ ...input, id: "not-a-uuid" as NewMobileMessage["id"] });
    expect(failed).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.contact.count({ where: { companyId: f.companyId } })).toBe(0);
      expect(await prisma.chat.count({ where: { companyId: f.companyId } })).toBe(0);
      expect(await prisma.chatMessage.count({ where: { companyId: f.companyId } })).toBe(0);
    });
  } finally { await f.cleanup(); }
});

test("rejects incompatible stored identity, content, dates and image size", async () => {
  const f = await fixture();
  try {
    const input = message(f.companyId, "mapper", { type: "image", size: 1 });
    expect((await storeOnce(input)).success).toBe(true);
    const row = await withTenantIsolation(f.companyId, async () => await prisma.chatMessage.findFirstOrThrow({
      where: { companyId: f.companyId }, include: { chat: { include: { contact: true } } },
    }));
    const { mapMobileMessage } = await import("@core/src/features/chats/infrastructure/mobile-message-repository");
    for (const corrupt of [
      { ...row, externalId: nativeId("999@lid", remoteChatId, "mapper") },
      { ...row, id: "12345678-1234-1234-1234-123456789abc" },
      { ...row, companyId: "12345678-1234-1234-1234-123456789abc" },
      { ...row, chatId: "12345678-1234-1234-1234-123456789abc" },
      { ...row, sentAt: new Date(Number.NaN) },
      { ...row, receivedAt: new Date("+010000-01-01T00:00:00.000Z") },
      { ...row, eventDispatchedAt: new Date(Number.NaN) },
      { ...row, imageSize: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
      { ...row, imageStatus: "failed" as typeof row.imageStatus },
      { ...row, uploadedByUserId: null },
    ]) expect(mapMobileMessage(corrupt)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    expect(mapMobileMessage({ ...row, eventDispatchedAt: new Date(row.receivedAt.getTime() - 1) }).success).toBe(true);
  } finally { await f.cleanup(); }
});

test("tenant scope cannot read or link another company's mobile message", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const input = message(a.companyId, "tenant", { type: "text", text: "private" });
    expect((await storeOnce(input)).success).toBe(true);
    const foreign = await withTenantIsolation(a.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { companyId: a.companyId } }));
    await withTenantIsolation(b.companyId, async () => {
      expect(await prisma.chatMessage.findFirst({ where: { id: foreign.id } })).toBeNull();
      expect(await prisma.chatMessage.updateMany({ where: { id: foreign.id }, data: { text: "changed" } })).toEqual({ count: 0 });
      await expect(prisma.chatMessage.create({ data: { companyId: b.companyId, chatId: foreign.chatId,
        externalId: "foreign", direction: "incoming", source: "contact", type: "text", text: "foreign", sentAt: new Date(), receivedAt: new Date() } })).rejects.toThrow();
    });
    expect(await withTenantIsolation(a.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { id: foreign.id } }))).toMatchObject({ text: "private" });
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("a deferred commit failure rolls back contact, chat and message", async () => {
  const f = await fixture();
  const admin = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  const trigger = `mobile_commit_${randomUUID().replaceAll("-", "")}`;
  await admin.connect();
  try {
    await admin.query(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected deferred message failure' USING ERRCODE = '23514'; END $$;
      CREATE CONSTRAINT TRIGGER "${trigger}" AFTER INSERT ON "ChatMessage" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW."companyId" = '${f.companyId}'::uuid) EXECUTE FUNCTION "${trigger}"()`);
    const result = await storeOnce(message(f.companyId, "commit", { type: "text", text: "rollback" }));
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.contact.count({ where: { companyId: f.companyId } })).toBe(0);
      expect(await prisma.chat.count({ where: { companyId: f.companyId } })).toBe(0);
      expect(await prisma.chatMessage.count({ where: { companyId: f.companyId } })).toBe(0);
    });
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS "${trigger}" ON "ChatMessage"; DROP FUNCTION IF EXISTS "${trigger}"()`);
    await admin.end();
    await f.cleanup();
  }
});

test("an unrelated message UUID collision fails and rolls back a new conversation", async () => {
  const f = await fixture();
  try {
    const first = message(f.companyId, "original", { type: "text", text: "original" });
    expect((await storeOnce(first)).success).toBe(true);
    const parsed = parseMobileMessage({ version: 1, message: { id: nativeId("789@lid", "987@lid", "collision"),
      accountId: "789@lid", chatId: "987@lid", whatsappMessageId: "collision", direction: "incoming",
      timestamp: 1791417600123, content: { type: "text", text: "other" } } });
    expect(parsed).not.toBeNull();
    const failed = await storeOnce({ ...parsed!, id: first.id, companyId: first.companyId,
      uploadedByUserId: "other-uploader", receivedAt: new Date("2026-10-08T12:00:01.456Z") });
    expect(failed).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.contact.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chat.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chatMessage.findMany({ where: { companyId: f.companyId } })).toMatchObject([
        { id: first.id, externalId: first.externalId, text: "original" },
      ]);
    });
  } finally { await f.cleanup(); }
});

test("sequential repeats preserve the first committed message", async () => {
  const f = await fixture();
  try {
    const first = message(f.companyId, "repeat", { type: "image", caption: "first", mimeType: "image/png", size: 9 });
    const stored = await storeOnce(first);
    expect(stored).toMatchObject({ success: true, data: { created: true } });
    const repeat = { ...message(f.companyId, "repeat", { type: "text", text: "changed" }, "outgoing", "other-uploader"),
      sentAt: new Date(first.sentAt.getTime() + 1), receivedAt: new Date(first.receivedAt.getTime() + 1) };
    expect(await storeOnce(repeat)).toEqual({ success: true, data: { created: false, message: stored.success ? stored.data.message : undefined } });
    const escaped = `wa-message:v1:${Buffer.from('["123\\u0040lid","456@lid","repeat"]').toString("base64url")}`;
    const escapedRepeat = message(f.companyId, "repeat", { type: "text", text: "escaped" }, "incoming", "third", escaped);
    expect(await storeOnce({ ...escapedRepeat, receivedAt: new Date(first.receivedAt.getTime() + 2) }))
      .toEqual({ success: true, data: { created: false, message: stored.success ? stored.data.message : undefined } });

    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.contact.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chat.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chatMessage.count({ where: { companyId: f.companyId } })).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("12 simultaneous first registrations create one contact, chat and message with one winner", async () => {
  const f = await fixture();
  try {
    const race = await Promise.all(Array.from({ length: 12 }, (_, index) => {
      const input = message(f.companyId, "race", { type: "text", text: `value ${index}` }, "incoming", `uploader ${index}`);
      return storeOnce({ ...input, sentAt: new Date(input.sentAt.getTime() + index),
        receivedAt: new Date(input.receivedAt.getTime() + index) });
    }));
    expect(race.every((result) => result.success)).toBe(true);
    expect(race.filter((result) => result.success && result.data.created)).toHaveLength(1);
    const winners = race.filter((result) => result.success).map((result) => result.data.message);
    expect(winners).toHaveLength(12);
    for (const winner of winners) expect(winner).toEqual(winners[0]);
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.contact.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chat.count({ where: { companyId: f.companyId } })).toBe(1);
      expect(await prisma.chatMessage.count({ where: { companyId: f.companyId } })).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("account, chat, protocol and company identify independent messages; uploader does not", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const make = (companyId: string, account: string, remote: string, protocol: string) => {
      const parsed = parseMobileMessage({ version: 1, message: { id: nativeId(account, remote, protocol), accountId: account,
        chatId: remote, whatsappMessageId: protocol, direction: "incoming", timestamp: 1791417600123,
        content: { type: "text", text: "identity" } } });
      expect(parsed).not.toBeNull();
      return { ...parsed!, id: randomUUID() as NewMobileMessage["id"], companyId: companyId as NewMobileMessage["companyId"],
        uploadedByUserId: "original", receivedAt: new Date("2026-10-08T12:00:00.456Z") };
    };
    const inputs = [make(a.companyId, "123@lid", "456@lid", "same"), make(a.companyId, "789@lid", "456@lid", "same"),
      make(a.companyId, "123@lid", "999@lid", "same"), make(a.companyId, "123@lid", "456@lid", "different"),
      make(b.companyId, "123@lid", "456@lid", "same")];
    const outcomes = await Promise.all(inputs.map(storeOnce));
    expect(outcomes.every((result) => result.success && result.data.created)).toBe(true);
    expect(new Set(outcomes.map((result) => result.success && result.data.message.id)).size).toBe(5);
    expect(await storeOnce({ ...inputs[0], id: randomUUID() as NewMobileMessage["id"], uploadedByUserId: "different" }))
      .toMatchObject({ success: true, data: { created: false, message: { id: outcomes[0].success ? outcomes[0].data.message.id : "" } } });
    await withTenantIsolation(a.companyId, async () => {
      expect(await prisma.contact.count({ where: { companyId: a.companyId } })).toBe(3);
      expect(await prisma.chat.count({ where: { companyId: a.companyId } })).toBe(3);
      expect(await prisma.chatMessage.count({ where: { companyId: a.companyId } })).toBe(4);
    });
    await withTenantIsolation(b.companyId, async () => expect(await prisma.chatMessage.count({ where: { companyId: b.companyId } })).toBe(1));
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("Cloud API and mobile may share an externalId without capturing each other's lookup", async () => {
  const f = await fixture();
  try {
    const input = message(f.companyId, "coexist", { type: "text", text: "mobile" });
    expect((await storeOnce(input)).success).toBe(true);
    const { recordMessage } = await import("@core/src/features/chats/application/record-message");
    const { ensureContact } = await import("@core/src/features/contacts/application/ensure-contact");
    const { contactRepository } = await import("@core/src/features/contacts/infrastructure/contact-repository");
    const { chatRepository } = await import("@core/src/features/chats/infrastructure/chat-repository");
    const { withinTransaction } = await import("@core/src/shared/infrastructure/persistance");
    const recordCloud = () => withTenantIsolation(f.companyId, () => recordMessage({ externalId: input.externalId,
      contactPhone: "+51912345678", contactName: null, origin: { direction: "incoming", source: "contact" },
      sentAt: input.sentAt, receivedAt: input.receivedAt, content: { type: "text", text: "cloud" },
    }, { ensureContact: (contact) => ensureContact(contact, contactRepository), chats: chatRepository,
      transaction: withinTransaction, storeImage: async () => { throw new Error("No image expected"); } }));
    const cloud = await recordCloud();
    expect(cloud).toMatchObject({ success: true, data: { status: "stored" } });
    expect(await recordCloud()).toEqual({ success: true, data: { status: "duplicate", messageId: cloud.success ? cloud.data.messageId : "" } });
    expect(await storeOnce({ ...input, id: randomUUID() as NewMobileMessage["id"] })).toMatchObject({
      success: true, data: { created: false, message: { id: input.id, content: { type: "text", text: "mobile" } } },
    });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.chatMessage.count({ where: { companyId: f.companyId, externalId: input.externalId } })).toBe(2);
    });
  } finally { await f.cleanup(); }
});

function undated(companyId: string, protocolId: string): NewMobileMessage {
  const parsed = parseMobileMessage({ version: 1, message: { id: nativeId(accountId, remoteChatId, protocolId), accountId, chatId: remoteChatId,
    whatsappMessageId: protocolId, direction: "incoming", content: { type: "text", text: "no date" } } });
  expect(parsed).not.toBeNull();
  return { ...parsed!, companyId: companyId as NewMobileMessage["companyId"], uploadedByUserId: "test-user",
    id: randomUUID() as NewMobileMessage["id"], receivedAt: new Date("2026-10-08T12:00:00.456Z") };
}

test("stores a mobile message without sentAt", async () => {
  const f = await fixture();
  try {
    const result = await storeOnce(undated(f.companyId, "undated"));
    expect(result).toMatchObject({ success: true, data: { created: true, message: { sentAt: null } } });
    await withTenantIsolation(f.companyId, async () => {
      expect((await prisma.chatMessage.findFirstOrThrow({ where: { companyId: f.companyId } })).sentAt).toBeNull();
    });
  } finally { await f.cleanup(); }
});

test("rejects a message without sentAt outside mobile rows", async () => {
  const f = await fixture();
  try {
    await expect(withTenantIsolation(f.companyId, async () => {
      const contact = await prisma.contact.create({ data: { companyId: f.companyId, phone: "+51912345678" } });
      const chat = await prisma.chat.create({ data: { companyId: f.companyId, contactId: contact.id } });
      await prisma.chatMessage.create({ data: { companyId: f.companyId, chatId: chat.id, externalId: "wamid.cloud",
        direction: "incoming", source: "contact", type: "text", text: "cloud", sentAt: null, receivedAt: new Date() } });
    })).rejects.toThrow(/ChatMessage_sentAt_required_outside_mobile_check|sentAt/);
  } finally { await f.cleanup(); }
});

test("deduplicates a mobile message without sentAt by company, chat and WhatsApp id", async () => {
  const f = await fixture();
  try {
    const first = await storeOnce(undated(f.companyId, "undated-repeat"));
    const repeat = await storeOnce(undated(f.companyId, "undated-repeat"));
    expect(first).toMatchObject({ success: true, data: { created: true } });
    expect(repeat).toMatchObject({ success: true, data: { created: false, message: { sentAt: null } } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.chatMessage.count({ where: { companyId: f.companyId } })).toBe(1);
    });
  } finally { await f.cleanup(); }
});
