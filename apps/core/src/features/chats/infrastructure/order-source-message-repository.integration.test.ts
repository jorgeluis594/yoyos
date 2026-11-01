import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findOrderSourceMessage } from "@core/src/features/chats/infrastructure/order-source-message-repository";

async function company() {
  const id = randomUUID();
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Source message", country: "PE" } }));
  return { id, cleanup: () => withTenantIsolation(id, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId: id } });
    await prisma.chat.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.image.deleteMany({ where: { companyId: id } });
    await prisma.company.deleteMany({ where: { id } });
  }) };
}

const base = { direction: "incoming" as const, source: "contact" as const, sentAt: new Date(0), receivedAt: new Date(), uploadedByUserId: "uploader" };

test("findOrderSourceMessage returns image and text messages and hides other companies", async () => {
  const [a, b] = [await company(), await company()];
  try {
    const rows = await withTenantIsolation(a.id, async () => {
      const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
      const chat = await prisma.chat.create({ data: { contactId: contact.id } });
      const image = await prisma.image.create({ data: { storageKey: "k" } });
      const common = { ...base, chatId: chat.id };
      const ready = await prisma.chatMessage.create({ data: { ...common, externalId: "ready", whatsappMessageId: "p1", type: "image", imageId: image.id, caption: "2 en talla M" } });
      const text = await prisma.chatMessage.create({ data: { ...common, externalId: "text", whatsappMessageId: "p3", type: "text", text: "hola" } });
      return { contact, chat, image, ready, text };
    });
    await withTenantIsolation(a.id, async () => {
      const expected = (m: { id: string; receivedAt: Date }, imageId: string | null, text: string | null, caption: string | null) => ({ success: true, data: {
        id: m.id, companyId: a.id, chatId: rows.chat.id, contactId: rows.contact.id, direction: "incoming", uploadedByUserId: "uploader", imageId, text, caption, sentAt: base.sentAt, receivedAt: m.receivedAt } });
      expect(await findOrderSourceMessage(rows.ready.id)).toEqual(expected(rows.ready, rows.image.id, null, "2 en talla M"));
      expect(await findOrderSourceMessage(rows.text.id)).toEqual(expected(rows.text, null, "hola", null));
      expect(await findOrderSourceMessage(randomUUID())).toEqual({ success: true, data: null });
    });
    await withTenantIsolation(b.id, async () => {
      expect(await findOrderSourceMessage(rows.ready.id)).toEqual({ success: true, data: null });
    });
  } finally { await a.cleanup(); await b.cleanup(); }
});
