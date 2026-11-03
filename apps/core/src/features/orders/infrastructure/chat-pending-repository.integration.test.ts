import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { findChatMemory, findChatPendings, findChatPendingsForUpdate, saveChatPendings } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import type { ChatPending, ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ProductId } from "@core/src/features/products/domain/product";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const chatId = await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Pendings", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    return (await prisma.chat.create({ data: { contactId: contact.id } })).id as ChatId;
  });
  return { companyId, chatId, async cleanup() {
    await withTenantIsolation(companyId, async () => {
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
  doubt: null, pointSince: new Date("2026-10-28T12:00:00.000Z"), acknowledgedAt: null,
};
const empty: ChatPendings = { pendings: [], readyRemembered: false };

test("saves and reads a chat's pendings within its company", async () => {
  const [x, y] = [await fixture(), await fixture()];
  try {
    const set: ChatPendings = { pendings: [variantPending], readyRemembered: true };
    await withTenantIsolation(x.companyId, async () => {
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: empty });
      expect(await withinTransaction(() => saveChatPendings(x.chatId, set))).toEqual({ success: true, data: null });
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: set });
      expect(await withinTransaction(() => findChatPendingsForUpdate(x.chatId))).toEqual({ success: true, data: set });
      const changed: ChatPendings = { pendings: [{ ...variantPending, quantity: 3 as PositiveInteger }], readyRemembered: false };
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
    await withTenantIsolation(x.companyId, () => withinTransaction(() => saveChatPendings(x.chatId, { pendings: [variantPending], readyRemembered: false })));
    await withTenantIsolation(y.companyId, async () => {
      expect(await findChatPendings(x.chatId)).toEqual({ success: true, data: empty });
      expect(await withinTransaction(() => findChatPendingsForUpdate(x.chatId))).toEqual({ success: true, data: empty });
      expect(await prisma.chatPendings.count()).toBe(0);
      // The chat belongs to the other company, so the row cannot be written even when its id is known.
      expect(await withinTransaction(() => saveChatPendings(x.chatId, { pendings: [variantPending], readyRemembered: false })))
        .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    });
  } finally { await x.cleanup(); await y.cleanup(); }
});

test("deletes the row when no pending and no remembered ready remain", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [variantPending], readyRemembered: true }));
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [], readyRemembered: true }));
      expect(await prisma.chatPendings.count()).toBe(1);
      expect(await findChatPendings(f.chatId)).toEqual({ success: true, data: { pendings: [], readyRemembered: true } });
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

test("keeps the photo memory and the last request time with an empty set of pendings and reads them back", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      expect(await findChatMemory(f.chatId)).toEqual({ success: true, data: { lastIncomingPhoto: null, lastRequestAt: null } });
      const memory = { lastIncomingPhoto: { left: null }, lastRequestAt: new Date("2026-10-30T12:00:00.000Z") };
      expect(await withinTransaction(() => saveChatPendings(f.chatId, empty, memory))).toEqual({ success: true, data: null });
      expect(await prisma.chatPendings.count()).toBe(1);
      expect(await findChatMemory(f.chatId)).toEqual({ success: true, data: memory });
      // Saving the pendings without a memory leaves the memory as it was.
      await withinTransaction(() => saveChatPendings(f.chatId, { pendings: [variantPending], readyRemembered: false }));
      expect(await findChatMemory(f.chatId)).toEqual({ success: true, data: memory });
      // Clearing the memory with nothing else left removes the row.
      await withinTransaction(() => saveChatPendings(f.chatId, empty, { lastIncomingPhoto: null, lastRequestAt: null }));
      expect(await prisma.chatPendings.count()).toBe(0);
    });
  } finally { await f.cleanup(); }
});

test("rejects a stored photo memory that fails its schema as invalid stored data", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await prisma.chatPendings.create({ data: { chatId: f.chatId, pendings: [], readyRemembered: false, lastIncomingPhoto: { left: { kind: "other" } }, updatedAt: new Date() } });
      expect(await findChatMemory(f.chatId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
  } finally { await f.cleanup(); }
});
