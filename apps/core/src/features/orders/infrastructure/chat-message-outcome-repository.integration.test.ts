import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { findOutcome, recordFailedOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import type { ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const messageId = randomUUID() as ChatMessageId;
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Outcomes", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    const chat = await prisma.chat.create({ data: { contactId: contact.id } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId: chat.id, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "hola", uploadedByUserId: sellerId, sentAt: new Date(), receivedAt: new Date() } });
  });
  return { companyId, messageId, async cleanup() {
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

const noIntent: ChatMessageOutcomes = [{ kind: "no_intent" }];

test("applying the same message twice records one outcome row", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      expect(await withinTransaction(() => recordOutcome({ messageId: f.messageId, outcomes: noIntent }))).toEqual({ success: true, data: null });
      expect(await withinTransaction(() => recordOutcome({ messageId: f.messageId, outcomes: noIntent }))).toMatchObject({ success: false, error: { code: "MESSAGE_ALREADY_PROCESSED" } });
      expect(await prisma.chatMessageOutcome.count()).toBe(1);
      expect(await findOutcome(f.messageId)).toEqual({ success: true, data: { outcomes: noIntent, noticeSentAt: null } });
    });
  } finally { await f.cleanup(); }
});

test("reads stored outcomes that do not match the schema as invalid stored data", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await prisma.chatMessageOutcome.create({ data: { messageId: f.messageId, outcomes: [{ kind: "added", variantId: "not-a-uuid" }] } });
      expect(await findOutcome(f.messageId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
  } finally { await f.cleanup(); }
});

test("outcome queries never see another company's messages", async () => {
  const [a, b] = [await fixture(), await fixture()];
  try {
    await withTenantIsolation(a.companyId, () => withinTransaction(() => recordOutcome({ messageId: a.messageId, outcomes: noIntent })));
    await withTenantIsolation(b.companyId, async () => {
      expect(await findOutcome(a.messageId)).toEqual({ success: true, data: null });
      expect(await recordFailedOutcome(a.messageId, "INVALID_AI_RESPONSE")).toEqual({ success: true, data: { publishNotice: false } });
      expect(await prisma.chatMessageOutcome.count()).toBe(0);
    });
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("records a failed outcome once and asks for its notice only the first time", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      expect(await recordFailedOutcome(f.messageId, "RETRIES_EXHAUSTED")).toEqual({ success: true, data: { publishNotice: true } });
      expect(await findOutcome(f.messageId)).toMatchObject({ success: true, data: { outcomes: [{ kind: "failed", errorCode: "RETRIES_EXHAUSTED" }], noticeSentAt: null } });
      expect(await recordFailedOutcome(f.messageId, "INVALID_AI_RESPONSE")).toEqual({ success: true, data: { publishNotice: true } }); // existing, notice still unclaimed
      await prisma.chatMessageOutcome.updateMany({ data: { noticeSentAt: new Date() } });
      expect(await recordFailedOutcome(f.messageId, "RETRIES_EXHAUSTED")).toEqual({ success: true, data: { publishNotice: false } });
      expect(await prisma.chatMessageOutcome.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("an existing outcome without a notice due is kept and asks for none", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => recordOutcome({ messageId: f.messageId, outcomes: noIntent }));
      expect(await recordFailedOutcome(f.messageId, "RETRIES_EXHAUSTED")).toEqual({ success: true, data: { publishNotice: false } });
      expect(await findOutcome(f.messageId)).toMatchObject({ success: true, data: { outcomes: noIntent } });
    });
  } finally { await f.cleanup(); }
});

test("a message that does not exist leaves no outcome and no notice", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      expect(await recordFailedOutcome(randomUUID() as ChatMessageId, "MESSAGE_NOT_FOUND")).toEqual({ success: true, data: { publishNotice: false } });
      expect(await prisma.chatMessageOutcome.count()).toBe(0);
    });
  } finally { await f.cleanup(); }
});
