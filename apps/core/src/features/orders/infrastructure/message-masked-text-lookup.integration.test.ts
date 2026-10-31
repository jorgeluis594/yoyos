import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { findMaskedTexts } from "@core/src/features/orders/infrastructure/message-masked-text-lookup";

async function company() {
  const id = randomUUID();
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Masked lookup", country: "PE" } }));
  return { id, cleanup: () => withTenantIsolation(id, async () => {
    await prisma.messageMaskedText.deleteMany({ where: { companyId: id } });
    await prisma.chatMessage.deleteMany({ where: { companyId: id } });
    await prisma.chat.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.deleteMany({ where: { id } });
  }) };
}

test("finds the stored masks of the given messages, leaves out the others and never reads another company", async () => {
  const [a, b] = [await company(), await company()];
  try {
    const rows = await withTenantIsolation(a.id, async () => {
      const contact = await prisma.contact.create({ data: { whatsappAccountId: `${randomUUID()}@lid`, whatsappLid: `${randomUUID()}@lid` } });
      const chat = await prisma.chat.create({ data: { contactId: contact.id } });
      const make = (key: string) => prisma.chatMessage.create({ data: { chatId: chat.id, externalId: key, whatsappMessageId: key, direction: "incoming", source: "contact",
        type: "text", text: key, sentAt: new Date(), receivedAt: new Date(), uploadedByUserId: "uploader" } });
      const [masked, plain] = [await make("masked"), await make("plain")];
      await prisma.messageMaskedText.create({ data: { messageId: masked.id, text: "mi número es 987******21", expiresAt: new Date(Date.now() + 86_400_000) } });
      return { masked: masked.id as ChatMessageId, plain: plain.id as ChatMessageId };
    });
    await withTenantIsolation(a.id, async () => {
      expect(await findMaskedTexts([rows.masked, rows.plain])).toEqual({ success: true, data: new Map([[rows.masked, "mi número es 987******21"]]) });
      expect(await findMaskedTexts([])).toEqual({ success: true, data: new Map() });
    });
    await withTenantIsolation(b.id, async () => {
      expect(await findMaskedTexts([rows.masked])).toEqual({ success: true, data: new Map() });
    });
  } finally { await a.cleanup(); await b.cleanup(); }
});
