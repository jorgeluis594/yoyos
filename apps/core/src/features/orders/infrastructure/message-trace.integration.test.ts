import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { MessageTrace } from "@core/src/features/orders/domain/reader/trace";
import { deleteConfiguredExpiredMessageTraces, readMessageTraces } from "@core/src/features/orders/composition";
import { findTraceQuotes, saveMessageTrace } from "@core/src/features/orders/infrastructure/message-trace-repository";
import { hashToken, parseTraceReaders } from "@core/src/features/orders/presentation/trace-reader-token";
import { runTraceRead } from "@core/src/features/orders/presentation/trace-read-command";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

afterAll(() => systemPrisma.$disconnect());

const day = 24 * 60 * 60 * 1000;

async function company(messageCount: number) {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const messageIds = Array.from({ length: messageCount }, () => randomUUID());
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Traces", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    const chat = await prisma.chat.create({ data: { contactId: contact.id } });
    await prisma.chatMessage.createMany({ data: messageIds.map((id) => ({ id, chatId: chat.id, externalId: `ext-${id}`, whatsappMessageId: `wa-${id}`, direction: "incoming" as const,
      source: "contact" as const, type: "text" as const, text: "hola", uploadedByUserId: sellerId, sentAt: new Date(), receivedAt: new Date() })) });
  });
  return { companyId: companyId as CompanyId, messageIds: messageIds as ChatMessageId[], async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.messageTraceRead.deleteMany();
      await prisma.messageTrace.deleteMany();
      await prisma.messageMaskedText.deleteMany();
      await prisma.chatMessage.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

const traceOf = (companyId: CompanyId, messageId: ChatMessageId, expiresAt: Date, contextMessageIds: ChatMessageId[] = []): MessageTrace => ({
  companyId, messageId, messageReceivedAt: new Date(expiresAt.getTime() - 90 * day), expiresAt, startedAt: new Date(), decidedAt: new Date(), queuedMs: 0, shadowWaitMs: null,
  textState: "masked", contextMessageIds, photo: null, stages: [], quotes: [{ id: 1 as never, text: "quiero 2 polos" }], decisions: [], shadow: null, costUsd: 0.01,
});

test("the retention job deletes every expired trace and masked text of every company in one run and keeps younger ones", async () => {
  const [a, b] = [await company(1200), await company(1)];
  try {
    const expired = new Date(Date.now() - day);
    const future = new Date(Date.now() + day);
    await withTenantIsolation(a.companyId, async () => {
      await prisma.$executeRaw`INSERT INTO "MessageTrace" ("companyId", "messageId", "messageReceivedAt", "expiresAt", "startedAt", "queuedMs", "textState", "contextMessageIds", "stages", "quotes", "decisions")
        SELECT ${a.companyId}::uuid, m, now(), ${expired}::timestamptz, now(), 0, 'masked', '{}', '[]', '[]', '[]' FROM unnest(${a.messageIds as string[]}::uuid[]) AS m`;
      await prisma.$executeRaw`INSERT INTO "MessageMaskedText" ("companyId", "messageId", "text", "expiresAt") VALUES (${a.companyId}::uuid, ${a.messageIds[0]!}::uuid, 'hola', ${expired}::timestamptz)`;
    });
    await withTenantIsolation(b.companyId, async () => {
      expect((await saveMessageTrace(traceOf(b.companyId, b.messageIds[0]!, future), [{ messageId: b.messageIds[0]!, text: "hola", expiresAt: future }])).success).toBe(true);
    });
    const result = await deleteConfiguredExpiredMessageTraces({ cutoff: new Date(), batchSize: 500 });
    expect(result).toMatchObject({ success: true, data: { deletedTraces: expect.any(Number), failedCompanies: 0 } });
    const counts = async (companyId: CompanyId) => withTenantIsolation(companyId, async () => ({ traces: await prisma.messageTrace.count(), texts: await prisma.messageMaskedText.count() }));
    expect(await counts(a.companyId)).toEqual({ traces: 0, texts: 0 });
    expect(await counts(b.companyId)).toEqual({ traces: 1, texts: 1 });
    if (result.success) expect(result.data.deletedTraces).toBeGreaterThanOrEqual(1200);
  } finally { await a.cleanup(); await b.cleanup(); }
}, 60_000);

test("saves a trace by upsert, reads only its quotes, and answers null once it is deleted", async () => {
  const c = await company(2);
  try {
    const [message, context] = c.messageIds as [ChatMessageId, ChatMessageId];
    const future = new Date(Date.now() + day);
    await withTenantIsolation(c.companyId, async () => {
      await saveMessageTrace(traceOf(c.companyId, message, future, [context]), [{ messageId: message, text: "quiero 2 polos", expiresAt: future }]);
      await saveMessageTrace({ ...traceOf(c.companyId, message, future, [context]), queuedMs: 7 }, [{ messageId: message, text: "otro texto", expiresAt: future }]);
      expect(await findTraceQuotes(message)).toEqual(ok([{ id: 1, text: "quiero 2 polos" }]));
      expect(await findTraceQuotes(context)).toEqual(ok(null));
      expect((await prisma.messageTrace.findFirstOrThrow()).queuedMs).toBe(7);
      expect((await prisma.messageMaskedText.findFirstOrThrow()).text).toBe("quiero 2 polos");
    });
  } finally { await c.cleanup(); }
});

test("the trace CLI refuses a reader without a valid token and records every read with the token's reader name", async () => {
  const c = await company(2);
  try {
    const [message, context] = c.messageIds as [ChatMessageId, ChatMessageId];
    const future = new Date(Date.now() + day);
    await withTenantIsolation(c.companyId, async () => {
      await saveMessageTrace(traceOf(c.companyId, message, future, [context]), [{ messageId: message, text: "quiero 2 polos", expiresAt: future }]);
    });
    const readers = parseTraceReaders(`Ana:${hashToken("ana-token")}`);
    const reads = async () => withTenantIsolation(c.companyId, async () => await prisma.messageTraceRead.findMany());
    const run = async (token: string | null) => {
      const out: string[] = [];
      let queried = false;
      const code = await runTraceRead({ args: ["--company", c.companyId, "--message", message], readers, token: async () => token, osUser: "node",
        read: (companyId, audit) => { queried = true; return readMessageTraces(companyId, audit); }, print: (text) => out.push(text), fail: () => undefined });
      return { code, out: out.join(""), queried };
    };
    for (const token of [null, "wrong"]) expect(await run(token)).toEqual({ code: 1, out: "", queried: false });
    expect(await reads()).toEqual([]);
    const read = await run("ana-token");
    expect(read.code).toBe(0);
    expect(JSON.parse(read.out).traces[0]).toMatchObject({ messageId: message, text: "quiero 2 polos", contextTexts: [{ messageId: context, text: "texto vencido" }] });
    expect(await reads()).toEqual([expect.objectContaining({ readerName: "Ana", osUser: "node", messageIds: [message] })]);
  } finally { await c.cleanup(); }
});

test("a trace cannot be read or deleted across companies", async () => {
  const [x, y] = [await company(1), await company(1)];
  try {
    const future = new Date(Date.now() + day);
    await withTenantIsolation(x.companyId, async () => { await saveMessageTrace(traceOf(x.companyId, x.messageIds[0]!, future), []); });
    await withTenantIsolation(y.companyId, async () => {
      expect(await prisma.messageTrace.count()).toBe(0);
      expect(await findTraceQuotes(x.messageIds[0]!)).toEqual(ok(null));
    });
  } finally { await x.cleanup(); await y.cleanup(); }
});
