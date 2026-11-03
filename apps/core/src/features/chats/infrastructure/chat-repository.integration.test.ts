import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findRecentChatMessages } from "@core/src/features/chats/composition";

async function company() {
  const id = randomUUID();
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Recent context", country: "PE" } }));
  return { id, cleanup: () => withTenantIsolation(id, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId: id } });
    await prisma.chat.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.deleteMany({ where: { id } });
  }) };
}

const hour = 3_600_000;
const now = new Date("2026-10-30T12:00:00Z");
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * hour);

async function chatWithMessages(spec: ReadonlyArray<Readonly<{ key: string; direction?: "incoming" | "outgoing"; sentAt: Date | null; text?: string }>>) {
  const contact = await prisma.contact.create({ data: { whatsappAccountId: `${randomUUID()}@lid`, whatsappLid: `${randomUUID()}@lid` } });
  const chat = await prisma.chat.create({ data: { contactId: contact.id } });
  const ids = new Map<string, string>();
  for (const message of spec) {
    const row = await prisma.chatMessage.create({ data: { chatId: chat.id, externalId: message.key, whatsappMessageId: message.key, direction: message.direction ?? "incoming",
      source: (message.direction ?? "incoming") === "incoming" ? "contact" : "seller", type: "text", text: message.text ?? message.key, sentAt: message.sentAt, receivedAt: now, uploadedByUserId: "uploader" } });
    ids.set(message.key, row.id);
  }
  return { chat, ids };
}

test("recent context messages include both directions within 48 hours, never another chat, and skip messages without sentAt", async () => {
  const [a, b] = [await company(), await company()];
  try {
    const { chat, ids, otherChat } = await withTenantIsolation(a.id, async () => {
      const own = await chatWithMessages([
        { key: "old", sentAt: at(60) },
        ...Array.from({ length: 20 }, (_, index) => ({ key: `m${index + 1}`, direction: index % 2 ? "outgoing" as const : "incoming" as const, sentAt: at(47 - index * 2) })),
        { key: "unsent", sentAt: null },
        { key: "current", sentAt: at(1) },
        { key: "later", sentAt: at(0.5) },
      ]);
      const other = await chatWithMessages([{ key: "elsewhere", sentAt: at(2) }]);
      return { ...own, otherChat: other.chat };
    });
    const query = (chatId: string, limit: number) => ({ chatId, anchor: at(1), messageId: ids.get("current")!, limit, windowHours: 48 });
    await withTenantIsolation(a.id, async () => {
      const found = await findRecentChatMessages(query(chat.id, 12));
      expect(found.success).toBe(true);
      if (!found.success) return;
      expect(found.data.map(({ id }) => id)).toEqual(Array.from({ length: 12 }, (_, index) => ids.get(`m${20 - index}`)));
      expect(new Set(found.data.map(({ direction }) => direction))).toEqual(new Set(["incoming", "outgoing"]));
      expect(found.data[0]).toMatchObject({ type: "text", text: "m20", caption: null, imageId: null, sentAt: at(47 - 19 * 2) });
      const wide = await findRecentChatMessages(query(chat.id, 100));
      expect(wide.success && wide.data.map(({ id }) => id)).toEqual(Array.from({ length: 20 }, (_, index) => ids.get(`m${20 - index}`)));
      const other = await findRecentChatMessages(query(otherChat.id, 12));
      expect(other.success && other.data.map(({ text }) => text)).toEqual(["elsewhere"]);
    });
    await withTenantIsolation(b.id, async () => {
      expect(await findRecentChatMessages(query(chat.id, 12))).toEqual({ success: true, data: [] });
    });
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("recent context messages break a tie on sentAt by id and exclude the anchor message itself", async () => {
  const a = await company();
  try {
    await withTenantIsolation(a.id, async () => {
      const { chat, ids } = await chatWithMessages([{ key: "p", sentAt: at(3) }, { key: "q", sentAt: at(3) }, { key: "r", sentAt: at(3) }]);
      const sorted = [...ids.entries()].sort(([, left], [, right]) => (left < right ? -1 : 1));
      const middle = sorted[1]!;
      const found = await findRecentChatMessages({ chatId: chat.id, anchor: at(3), messageId: middle[1], limit: 12, windowHours: 48 });
      expect(found.success && found.data.map(({ id }) => id)).toEqual([sorted[0]![1]]);
    });
  } finally { await a.cleanup(); }
});
