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

const base = { direction: "incoming" as const, source: "contact" as const, sentAt: new Date(0), receivedAt: new Date(), userId: null, uploadedByUserId: "uploader" };

test("findOrderSourceMessage returns ready, text and metadata_only rows and hides other companies", async () => {
  const [a, b] = [await company(), await company()];
  try {
    const rows = await withTenantIsolation(a.id, async () => {
      const contact = await prisma.contact.create({ data: { phone: "+51912345678" } });
      const chat = await prisma.chat.create({ data: { contactId: contact.id } });
      const image = await prisma.image.create({ data: { storageKey: "k" } });
      const common = { ...base, chatId: chat.id, whatsappMediaId: null };
      const ready = await prisma.chatMessage.create({ data: { ...common, externalId: "ready", whatsappMessageId: "p1", type: "image", imageStatus: "ready", imageId: image.id } });
      const meta = await prisma.chatMessage.create({ data: { ...common, externalId: "meta", whatsappMessageId: "p2", type: "image", imageStatus: "metadata_only" } });
      const text = await prisma.chatMessage.create({ data: { ...common, externalId: "text", whatsappMessageId: "p3", type: "text", text: "hola" } });
      return { contact, chat, image, ready, meta, text };
    });
    await withTenantIsolation(a.id, async () => {
      const expected = (m: { id: string }, imageId: string | null) => ({ success: true, data: {
        id: m.id, companyId: a.id, chatId: rows.chat.id, contactId: rows.contact.id, direction: "incoming", uploadedByUserId: "uploader", imageId } });
      expect(await findOrderSourceMessage(rows.ready.id)).toEqual(expected(rows.ready, rows.image.id));
      expect(await findOrderSourceMessage(rows.meta.id)).toEqual(expected(rows.meta, null));
      expect(await findOrderSourceMessage(rows.text.id)).toEqual(expected(rows.text, null));
      expect(await findOrderSourceMessage(randomUUID())).toEqual({ success: true, data: null });
    });
    await withTenantIsolation(b.id, async () => {
      expect(await findOrderSourceMessage(rows.ready.id)).toEqual({ success: true, data: null });
    });
  } finally { await a.cleanup(); await b.cleanup(); }
});
