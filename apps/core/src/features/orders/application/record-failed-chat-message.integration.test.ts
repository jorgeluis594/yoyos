import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { err } from "@shared/functional";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { recordFailedChatMessage, type RecordFailedChatMessageDependencies } from "@core/src/features/orders/application/record-failed-chat-message";
import { findOutcome, insertFailedOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import { findChatMemory, findChatPendings, saveChatPendings, saveLastIncomingPhotoOfMessageChat } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const chatId = randomUUID() as ChatId;
  const messageId = randomUUID() as ChatMessageId;
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Failed messages", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId: contact.id } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "hola", uploadedByUserId: sellerId, sentAt: new Date(), receivedAt: new Date() } });
  });
  const inTenant = <T,>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  return { companyId, chatId, messageId, inTenant, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.chatPendings.deleteMany();
      await prisma.chatMessageOutcome.deleteMany();
      await prisma.chatMessage.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

const real: RecordFailedChatMessageDependencies = { transaction: (work) => withinTransaction(work), insertFailedOutcome, saveLastIncomingPhotoOfMessageChat };
const leftPending = { left: { kind: "pending" as const, pendingId: randomUUID() as ChatPendingId } };

test("a failed message after a photo leaves the failed outcome and a memory with no leftover", async () => {
  const f = await fixture();
  try {
    await f.inTenant(async () => {
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [], readyRemembered: true }, { lastIncomingPhoto: leftPending, lastRequestAt: null }));
      expect(await recordFailedChatMessage(real)(f.messageId, "INVALID_AI_RESPONSE")).toEqual({ success: true, data: { publishNotice: true } });
      expect(await findOutcome(f.messageId)).toMatchObject({ success: true, data: { outcomes: [{ kind: "failed", errorCode: "INVALID_AI_RESPONSE" }] } });
      expect(await findChatPendings(f.chatId)).toEqual({ success: true, data: { pendings: [], readyRemembered: true } });
      expect(await findChatMemory(f.chatId)).toMatchObject({ success: true, data: { lastIncomingPhoto: { left: null } } });
    });
  } finally { await f.cleanup(); }
});

test("a retry after the memory write failed records the failure once and writes the memory", async () => {
  const f = await fixture();
  try {
    await f.inTenant(async () => {
      const failing: RecordFailedChatMessageDependencies = { ...real, saveLastIncomingPhotoOfMessageChat: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) };
      expect(await recordFailedChatMessage(failing)(f.messageId, "INVALID_AI_RESPONSE")).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      // Both writes rolled back together: no failed row, no memory.
      expect(await findOutcome(f.messageId)).toEqual({ success: true, data: null });
      expect(await prisma.chatPendings.count()).toBe(0);
      expect(await recordFailedChatMessage(real)(f.messageId, "INVALID_AI_RESPONSE")).toEqual({ success: true, data: { publishNotice: true } });
      expect(await prisma.chatMessageOutcome.count()).toBe(1);
      expect(await findChatMemory(f.chatId)).toMatchObject({ success: true, data: { lastIncomingPhoto: { left: null } } });
    });
  } finally { await f.cleanup(); }
});

test("a retry that finds a stored failure without the memory writes the memory", async () => {
  const f = await fixture();
  try {
    await f.inTenant(async () => {
      await withinTransaction(() => insertFailedOutcome(f.messageId, "RETRIES_EXHAUSTED"));
      expect(await prisma.chatPendings.count()).toBe(0);
      expect(await recordFailedChatMessage(real)(f.messageId, "RETRIES_EXHAUSTED")).toEqual({ success: true, data: { publishNotice: true } });
      expect(await findChatMemory(f.chatId)).toMatchObject({ success: true, data: { lastIncomingPhoto: { left: null } } });
    });
  } finally { await f.cleanup(); }
});

test("a failure of a message that was applied leaves the memory the message wrote", async () => {
  const f = await fixture();
  try {
    await f.inTenant(async () => {
      await withinTransaction(async () => {
        await recordOutcome({ messageId: f.messageId, outcomes: [{ kind: "no_intent" }] });
        return saveChatPendings(f.chatId, { pendings: [], readyRemembered: false }, { lastIncomingPhoto: leftPending, lastRequestAt: null });
      });
      expect(await recordFailedChatMessage(real)(f.messageId, "RETRIES_EXHAUSTED")).toEqual({ success: true, data: { publishNotice: false } });
      expect(await findChatMemory(f.chatId)).toMatchObject({ success: true, data: { lastIncomingPhoto: leftPending } });
    });
  } finally { await f.cleanup(); }
});

test("a missing message writes no outcome and no memory", async () => {
  const f = await fixture();
  try {
    await f.inTenant(async () => {
      expect(await recordFailedChatMessage(real)(randomUUID() as ChatMessageId, "MESSAGE_NOT_FOUND")).toEqual({ success: true, data: { publishNotice: false } });
      expect(await prisma.chatMessageOutcome.count()).toBe(0);
      expect(await prisma.chatPendings.count()).toBe(0);
    });
  } finally { await f.cleanup(); }
});
