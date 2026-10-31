import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { findChatPendings, findChatPendingsForUpdate, saveChatPendings, saveLastIncomingPhotoOfMessageChat } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import type { ChatPending, ChatPendingId, ChatPendings, LastIncomingPhoto } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const chatId = await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Pendings", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    return (await prisma.chat.create({ data: { contactId: contact.id } })).id as ChatId;
  });
  return { companyId, chatId, async message() {
    return withTenantIsolation(companyId, async () => (await prisma.chatMessage.create({ data: { chatId, externalId: randomUUID(), whatsappMessageId: randomUUID(), direction: "incoming", source: "contact", type: "text", text: "hola", sentAt: new Date(0), receivedAt: new Date(), uploadedByUserId: "uploader" } })).id as ChatMessageId);
  }, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.chatMessage.deleteMany();
      await prisma.chatPendings.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

const pendingId = randomUUID() as ChatPendingId;
const variantPending: ChatPending = {
  id: pendingId, subject: { kind: "variant", productId: randomUUID() as ProductId }, known: { Talla: "M" }, quantity: 2 as PositiveInteger,
  price: { amount: { amount: 70, currency: "PEN" }, per: "lot", forQuantity: 2 as PositiveInteger },
  order: null, lastChangedAt: new Date("2026-10-28T12:00:00.000Z"), sourceMessageId: randomUUID() as ChatMessageId, requestId: pendingId,
};
const empty: ChatPendings = { pendings: [], readyRemembered: false, lastIncomingPhoto: null };

test("saves and reads a chat's pendings within its company", async () => {
  const [x, y] = [await fixture(), await fixture()];
  try {
    const set: ChatPendings = { pendings: [variantPending], readyRemembered: true, lastIncomingPhoto: null };
    await withTenantIsolation(x.companyId, async () => {
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: empty });
      expect(await withinTransaction(() => saveChatPendings(x.chatId, set))).toEqual({ success: true, data: null });
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: set });
      expect(await withinTransaction(() => findChatPendingsForUpdate(x.chatId))).toEqual({ success: true, data: set });
      const changed: ChatPendings = { pendings: [{ ...variantPending, quantity: 3 as PositiveInteger }], readyRemembered: false, lastIncomingPhoto: null };
      expect(await withinTransaction(() => saveChatPendings(x.chatId, changed))).toEqual({ success: true, data: null });
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: changed });
      expect(await prisma.chatPendings.count()).toBe(1);
    });
    await withTenantIsolation(y.companyId, async () => {
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: empty });
    });
  } finally { await x.cleanup(); await y.cleanup(); }
});

test("never reads another company's pendings", async () => {
  const [x, y] = [await fixture(), await fixture()];
  try {
    const stored: ChatPendings = { pendings: [variantPending], readyRemembered: false, lastIncomingPhoto: null };
    const messageId = await x.message();
    await withTenantIsolation(x.companyId, () => withinTransaction(() => saveChatPendings(x.chatId, stored)));
    await withTenantIsolation(y.companyId, async () => {
      // The message belongs to the other company: nothing is written and no error is raised.
      expect(await withinTransaction(() => saveLastIncomingPhotoOfMessageChat(messageId, { left: null }))).toEqual({ success: true, data: null });
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: empty });
      expect(await withinTransaction(() => findChatPendingsForUpdate(x.chatId))).toEqual({ success: true, data: empty });
      expect(await prisma.chatPendings.count()).toBe(0);
      // The chat belongs to the other company, so the row cannot be written even when its id is known.
      expect(await withinTransaction(() => saveChatPendings(x.chatId, { pendings: [variantPending], readyRemembered: false, lastIncomingPhoto: null })))
        .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    });
    await withTenantIsolation(x.companyId, async () => {
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: stored });
    });
  } finally { await x.cleanup(); await y.cleanup(); }
});

test("deletes the row when no pending and no remembered ready remain", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [variantPending], readyRemembered: true, lastIncomingPhoto: null }));
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [], readyRemembered: true, lastIncomingPhoto: null }));
      expect(await prisma.chatPendings.count()).toBe(1);
      expect(await findChatPendings(f.chatId)).toEqual({ success: true, data: { pendings: [], readyRemembered: true, lastIncomingPhoto: null } });
      await withinTransaction(() => saveChatPendings(f.chatId, empty));
      expect(await prisma.chatPendings.count()).toBe(0);
      expect(await findChatPendings(f.chatId)).toEqual({ success: true, data: empty });
      expect(await withinTransaction(() => saveChatPendings(f.chatId, empty))).toEqual({ success: true, data: null });
    });
  } finally { await f.cleanup(); }
});

test("rejects a stored row that fails its schema as invalid stored data", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const stored = { ...JSON.parse(JSON.stringify(variantPending)), subject: { kind: "other", productId: randomUUID() } };
      await prisma.chatPendings.create({ data: { chatId: f.chatId, pendings: [stored], readyRemembered: false, updatedAt: new Date() } });
      expect(await findChatPendings(f.chatId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
      expect(await withinTransaction(() => findChatPendingsForUpdate(f.chatId))).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
  } finally { await f.cleanup(); }
});

const photoItem: LastIncomingPhoto = { left: { kind: "item", orderId: randomUUID() as OrderId, variantId: randomUUID() as VariantId, quantity: 3 as PositiveInteger } };

test("saves and reads a last incoming photo with no pending", async () => {
  const [x, y] = [await fixture(), await fixture()];
  try {
    const set: ChatPendings = { pendings: [], readyRemembered: false, lastIncomingPhoto: photoItem };
    await withTenantIsolation(x.companyId, async () => {
      expect(await withinTransaction(() => saveChatPendings(x.chatId, set))).toEqual({ success: true, data: null });
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: set });
      expect(await withinTransaction(() => findChatPendingsForUpdate(x.chatId))).toEqual({ success: true, data: set });
      const nothing: ChatPendings = { ...set, lastIncomingPhoto: { left: null } };
      await withinTransaction(() => saveChatPendings(x.chatId, nothing));
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: nothing });
    });
    await withTenantIsolation(y.companyId, async () => {
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: empty });
    });
  } finally { await x.cleanup(); await y.cleanup(); }
});

test("deletes the row when there is no pending, no listo and no memory", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [], readyRemembered: false, lastIncomingPhoto: photoItem }));
      expect(await prisma.chatPendings.count()).toBe(1);
      await withinTransaction(() => saveChatPendings(f.chatId, empty));
      expect(await prisma.chatPendings.count()).toBe(0);
    });
  } finally { await f.cleanup(); }
});

test("reads a stored row whose memory column is NULL and rejects a stored memory with quantity 0", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await prisma.chatPendings.create({ data: { chatId: f.chatId, pendings: [], readyRemembered: true, updatedAt: new Date() } });
      expect(await findChatPendings(f.chatId)).toEqual({ success: true, data: { pendings: [], readyRemembered: true, lastIncomingPhoto: null } });
      const bad = { left: { kind: "item", orderId: randomUUID(), variantId: randomUUID(), quantity: 0 } };
      await prisma.chatPendings.update({ where: { companyId_chatId: { companyId: f.companyId, chatId: f.chatId } }, data: { lastIncomingPhoto: bad } });
      expect(await findChatPendings(f.chatId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
      expect(await withinTransaction(() => findChatPendingsForUpdate(f.chatId))).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
  } finally { await f.cleanup(); }
});

test("saving the memory of a message's chat keeps its pendings and listo", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const messageId = await f.message();
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [variantPending], readyRemembered: true, lastIncomingPhoto: null }));
      expect(await withinTransaction(() => saveLastIncomingPhotoOfMessageChat(messageId, { left: null }))).toEqual({ success: true, data: null });
      expect(await findChatPendings(f.chatId)).toEqual({ success: true, data: { pendings: [variantPending], readyRemembered: true, lastIncomingPhoto: { left: null } } });
    });
  } finally { await f.cleanup(); }
});

test("saving the memory of a message's chat creates the row when the chat has none", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const messageId = await f.message();
      expect(await prisma.chatPendings.count()).toBe(0);
      await withinTransaction(() => saveLastIncomingPhotoOfMessageChat(messageId, { left: null }));
      expect(await findChatPendings(f.chatId)).toEqual({ success: true, data: { pendings: [], readyRemembered: false, lastIncomingPhoto: { left: null } } });
    });
  } finally { await f.cleanup(); }
});

test("saving the memory for a message that does not exist writes nothing", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      expect(await withinTransaction(() => saveLastIncomingPhotoOfMessageChat(randomUUID() as ChatMessageId, { left: null }))).toEqual({ success: true, data: null });
      expect(await prisma.chatPendings.count()).toBe(0);
    });
  } finally { await f.cleanup(); }
});
