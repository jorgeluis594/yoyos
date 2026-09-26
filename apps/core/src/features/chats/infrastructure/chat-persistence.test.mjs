import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "vitest";

test("WhatsApp persistence deduplicates conversations and stores completed image outcomes", async () => {
  const appUrl = process.env.DATABASE_URL;
  expect(appUrl, "run sh scripts/run-tests.sh integration to prepare core_test").toBeTruthy();
  const adminUrl = new URL(appUrl);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const phone = "+14155552671";
  const prefix = `wa_${crypto.randomUUID().replaceAll("-", "")}`;
  const { prisma, withTenantIsolation, withinTransaction } = await import("@core/src/shared/infrastructure/persistance");
  const { recordMessage } = await import("@core/src/features/chats/application/record-message.ts");
  const { ensureContact } = await import("@core/src/features/contacts/application/ensure-contact.ts");
  const { contactRepository } = await import("@core/src/features/contacts/infrastructure/contact-repository.ts");
  const { chatRepository } = await import("@core/src/features/chats/infrastructure/chat-repository.ts");
  let imageId;
  const makeMessage = (externalId, content = { type: "text", text: "original" }, contactPhone = phone) => ({
    externalId, contactPhone, contactName: "Ada",
    origin: { direction: "incoming", source: "contact" }, sentAt: new Date("2026-01-01T00:00:00Z"), receivedAt: new Date("2026-01-01T00:00:01Z"), content,
  });
  const record = (companyId, externalId, content, contactPhone) => withTenantIsolation(companyId, () => recordMessage(makeMessage(externalId, content, contactPhone), {
    ensureContact: (input) => ensureContact(input, contactRepository), chats: chatRepository, transaction: withinTransaction,
    storeImage: async (_id, mediaId) => ({ success: true, data: mediaId === "invalid" ? { status: "failed", mediaId, failure: { code: "INVALID_IMAGE", message: "Invalid image" } } : mediaId === "storage-down" ? { status: "failed", mediaId, failure: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "Storage unavailable" } } : { status: "ready", mediaId, imageId } }),
  }));
  const cleanup = async (companyId) => withTenantIsolation(companyId, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId } });
    await prisma.image.deleteMany({ where: { companyId } });
    await prisma.chat.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });
  let stage = "setup";

  try {
    stage = "create companies";
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "WhatsApp test", country: "PE" } }));
    stage = "concurrent message writes";
    const concurrent = await Promise.all([
      record(companyA, `${prefix}-1`),
      record(companyA, `${prefix}-2`),
    ]);
    expect(concurrent.every((result) => result.success && result.data.status === "stored")).toBe(true);
    stage = "second company";
    const otherCompany = await record(companyB, `${prefix}-other`);
    expect(otherCompany.success).toBe(true);
    await withTenantIsolation(companyA, async () => {
      expect(await prisma.contact.count({ where: { companyId: companyA, phone } })).toBe(1);
      expect(await prisma.chat.count({ where: { companyId: companyA } })).toBe(1);
      expect(await prisma.chatMessage.count({ where: { companyId: companyA } })).toBe(2);
      const foreignContact = await withTenantIsolation(companyB, async () => await prisma.contact.findFirstOrThrow({ where: { companyId: companyB } }));
      await expect(prisma.chat.create({ data: { companyId: companyA, contactId: foreignContact.id } })).rejects.toThrow();
      const chat = await prisma.chat.findFirstOrThrow({ where: { companyId: companyA } });
      await expect(prisma.chatMessage.create({ data: { companyId: companyA, chatId: chat.id, externalId: `${prefix}-invalid-origin`, direction: "incoming", source: "seller", type: "text", text: "invalid", sentAt: new Date(), receivedAt: new Date() } })).rejects.toThrow();
    });
    stage = "duplicate check";
    expect(await record(companyA, `${prefix}-1`, { type: "text", text: "overwrite" })).toMatchObject({ success: true, data: { status: "duplicate" } });
    await withTenantIsolation(companyA, async () => {
      expect(await prisma.chatMessage.findFirst({ where: { companyId: companyA, externalId: `${prefix}-1` }, select: { text: true } })).toEqual({ text: "original" });
    });

    stage = "image outcomes";
    await withTenantIsolation(companyA, async () => {
      imageId = (await prisma.image.create({ data: { companyId: companyA, sourceKey: `whatsapp-message:${prefix}-ready-image`, storageKey: `${companyA}/ready`, visibility: "private", importStatus: "ready", importCompletedAt: new Date() } })).id;
    });
    expect(await record(companyA, `${prefix}-ready-image`, { type: "image", mediaId: "media-ready", caption: null })).toMatchObject({ success: true, data: { status: "stored" } });
    expect(await record(companyA, `${prefix}-invalid-image`, { type: "image", mediaId: "invalid", caption: null })).toMatchObject({ success: true, data: { status: "stored" } });
    expect(await record(companyA, `${prefix}-storage-image`, { type: "image", mediaId: "storage-down", caption: null })).toMatchObject({ success: true, data: { status: "stored" } });
    await withTenantIsolation(companyA, async () => {
      expect(await prisma.chatMessage.findFirst({ where: { externalId: `${prefix}-ready-image` }, select: { imageStatus: true, imageId: true } })).toEqual({ imageStatus: "ready", imageId });
      expect(await prisma.chatMessage.findFirst({ where: { externalId: `${prefix}-invalid-image` }, select: { imageStatus: true, imageFailureCode: true } })).toEqual({ imageStatus: "failed", imageFailureCode: "INVALID_IMAGE" });
      expect(await prisma.chatMessage.findFirst({ where: { externalId: `${prefix}-storage-image` }, select: { imageStatus: true, imageFailureCode: true } })).toEqual({ imageStatus: "failed", imageFailureCode: "IMAGE_STORAGE_UNAVAILABLE" });
    });

    stage = "rollback";
    await admin.$executeRawUnsafe(`CREATE FUNCTION public.${prefix}_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."companyId" = '${companyA}'::uuid AND NEW."externalId" = '${prefix}-rollback' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER ${prefix}_reject BEFORE INSERT ON public."ChatMessage" FOR EACH ROW EXECUTE FUNCTION public.${prefix}_reject()`);
    try {
      const rolledBack = await record(companyA, `${prefix}-rollback`, { type: "text", text: "rollback" }, "+14155552672");
      expect(rolledBack).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      await withTenantIsolation(companyA, async () => {
        expect(await prisma.contact.count({ where: { companyId: companyA, phone: "+14155552672" } })).toBe(0);
        expect(await prisma.chat.count({ where: { companyId: companyA } })).toBe(1);
      });
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER ${prefix}_reject ON public."ChatMessage"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION public.${prefix}_reject()`);
    }
  } catch (error) {
    throw new Error(stage, { cause: error });
  } finally {
    await cleanup(companyA);
    await cleanup(companyB);
    await admin.$disconnect();
  }
});
