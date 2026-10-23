import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { claimNotice, releaseNotice } from "@core/src/features/orders/infrastructure/chat-message-notice-repository";
import type { ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const chatId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Notices", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId: contact.id } });
  });
  const addMessage = (outcomes: ChatMessageOutcomes, sessionId: string | null = "session-1") => withTenantIsolation(companyId, async () => {
    const messageId = randomUUID() as ChatMessageId;
    await prisma.chatMessage.create({ data: { id: messageId, chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "hola", uploadedByUserId: sellerId, registeredBySessionId: sessionId, sentAt: new Date(), receivedAt: new Date() } });
    await prisma.chatMessageOutcome.create({ data: { messageId, outcomes } });
    return messageId;
  });
  return { companyId, chatId, addMessage, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.chatMessageOutcome.deleteMany();
      await prisma.chatMessage.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

const notIdentified: ChatMessageOutcomes = [{ kind: "not_identified", source: "photo", identification: null, silent: false }];
const noIntent: ChatMessageOutcomes = [{ kind: "no_intent" }];
const sentAt = (f: Awaited<ReturnType<typeof fixture>>, messageId: ChatMessageId) =>
  withTenantIsolation(f.companyId, async () => (await prisma.chatMessageOutcome.findFirstOrThrow({ where: { messageId } })).noticeSentAt);

test("the notice claim succeeds once for concurrent claims", async () => {
  const f = await fixture();
  try {
    const messageId = await f.addMessage(notIdentified);
    const claims = await withTenantIsolation(f.companyId, () => Promise.all(Array.from({ length: 5 }, () => claimNotice(messageId))));
    expect(claims.every((claim) => claim.success)).toBe(true);
    const won = claims.flatMap((claim) => (claim.success && claim.data ? claim.data : []));
    expect(won).toEqual([{ messageId, chatId: f.chatId, sessionId: "session-1", notice: { kind: "not_identified", source: "photo", newOrderId: null } }]);
    expect(await sentAt(f, messageId)).toBeInstanceOf(Date);
  } finally { await f.cleanup(); }
});

test("the notice claim writes nothing when no notice is due", async () => {
  const f = await fixture();
  try {
    const silent = await f.addMessage(noIntent);
    const unregistered = await f.addMessage(notIdentified, null);
    await withTenantIsolation(f.companyId, async () => {
      expect(await claimNotice(silent)).toEqual({ success: true, data: null });
      expect(await claimNotice(unregistered)).toEqual({ success: true, data: null });
      expect(await claimNotice(randomUUID() as ChatMessageId)).toEqual({ success: true, data: null });
    });
    expect(await sentAt(f, silent)).toBeNull();
    expect(await sentAt(f, unregistered)).toBeNull();
  } finally { await f.cleanup(); }
});

test("a released notice can be claimed again", async () => {
  const f = await fixture();
  try {
    const messageId = await f.addMessage(notIdentified);
    await withTenantIsolation(f.companyId, async () => {
      expect(await claimNotice(messageId)).toMatchObject({ success: true, data: { messageId } });
      expect(await claimNotice(messageId)).toEqual({ success: true, data: null });
      expect(await releaseNotice(messageId)).toEqual({ success: true, data: null });
      expect(await claimNotice(messageId)).toMatchObject({ success: true, data: { messageId } });
    });
  } finally { await f.cleanup(); }
});

test("claims and releases never touch another company's messages", async () => {
  const [a, b] = [await fixture(), await fixture()];
  try {
    const messageId = await a.addMessage(notIdentified);
    await withTenantIsolation(b.companyId, async () => {
      expect(await claimNotice(messageId)).toEqual({ success: true, data: null });
      expect(await releaseNotice(messageId)).toEqual({ success: true, data: null });
    });
    expect(await sentAt(a, messageId)).toBeNull();
    await withTenantIsolation(a.companyId, async () => { await claimNotice(messageId); });
    await withTenantIsolation(b.companyId, async () => { await releaseNotice(messageId); });
    expect(await sentAt(a, messageId)).toBeInstanceOf(Date);
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("reads stored outcomes that do not match the schema as invalid stored data and leaves them unclaimed", async () => {
  const f = await fixture();
  try {
    const messageId = await f.addMessage([{ kind: "added", variantId: "not-a-uuid" }] as never);
    await withTenantIsolation(f.companyId, async () => {
      expect(await claimNotice(messageId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
    expect(await sentAt(f, messageId)).toBeNull();
  } finally { await f.cleanup(); }
});
