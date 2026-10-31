import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { findOutcome, insertFailedOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
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

const insertFailed = (messageId: ChatMessageId, code: Parameters<typeof insertFailedOutcome>[1]) => withinTransaction(() => insertFailedOutcome(messageId, code));

test("outcome queries never see another company's messages", async () => {
  const [a, b] = [await fixture(), await fixture()];
  try {
    await withTenantIsolation(a.companyId, () => withinTransaction(() => recordOutcome({ messageId: a.messageId, outcomes: noIntent })));
    await withTenantIsolation(b.companyId, async () => {
      expect(await findOutcome(a.messageId)).toEqual({ success: true, data: null });
      expect(await insertFailed(a.messageId, "INVALID_AI_RESPONSE")).toEqual({ success: true, data: { inserted: false, stored: null } });
      expect(await prisma.chatMessageOutcome.count()).toBe(0);
    });
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("inserting a failed outcome writes it once and returns what is stored", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const failed = [{ kind: "failed", errorCode: "RETRIES_EXHAUSTED" }];
      expect(await insertFailed(f.messageId, "RETRIES_EXHAUSTED")).toEqual({ success: true, data: { inserted: true, stored: { outcomes: failed, noticeSentAt: null } } });
      expect(await findOutcome(f.messageId)).toMatchObject({ success: true, data: { outcomes: failed, noticeSentAt: null } });
      expect(await insertFailed(f.messageId, "INVALID_AI_RESPONSE")).toEqual({ success: true, data: { inserted: false, stored: { outcomes: failed, noticeSentAt: null } } });
      const claimedAt = new Date();
      await prisma.chatMessageOutcome.updateMany({ data: { noticeSentAt: claimedAt } });
      expect(await insertFailed(f.messageId, "RETRIES_EXHAUSTED")).toMatchObject({ success: true, data: { inserted: false, stored: { noticeSentAt: claimedAt } } });
      expect(await prisma.chatMessageOutcome.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("inserting a failed outcome for a message with an outcome writes nothing and returns the stored one", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => recordOutcome({ messageId: f.messageId, outcomes: noIntent }));
      expect(await insertFailed(f.messageId, "RETRIES_EXHAUSTED")).toEqual({ success: true, data: { inserted: false, stored: { outcomes: noIntent, noticeSentAt: null } } });
      expect(await findOutcome(f.messageId)).toMatchObject({ success: true, data: { outcomes: noIntent } });
    });
  } finally { await f.cleanup(); }
});

test("inserting a failed outcome for a missing message writes nothing, logs chat_message_outcome_without_message and keeps the transaction usable", async () => {
  const f = await fixture();
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  try {
    await withTenantIsolation(f.companyId, async () => {
      const result = await withinTransaction(async () => {
        const inserted = await insertFailedOutcome(randomUUID() as ChatMessageId, "MESSAGE_NOT_FOUND");
        // The transaction is still usable after the insert found no message.
        const count = await prisma.chatMessageOutcome.count();
        return { success: true as const, data: { inserted, count } };
      });
      expect(result).toEqual({ success: true, data: { inserted: { success: true, data: { inserted: false, stored: null } }, count: 0 } });
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "chat_message_outcome_without_message" }), "chat_message_outcome_without_message");
      expect(await prisma.chatMessageOutcome.count()).toBe(0);
    });
  } finally { warn.mockRestore(); await f.cleanup(); }
});
