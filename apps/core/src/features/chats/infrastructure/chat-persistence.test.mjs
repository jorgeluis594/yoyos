import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "vitest";

test("WhatsApp persistence deduplicates concurrent conversations and safely reclaims image work", async () => {
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
  const { prisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
  const { recordWhatsAppMessage } = await import("@core/src/features/chats/application/record-message.ts");
  const { imageWorkRepository } = await import("@core/src/features/chats/infrastructure/message-image-worker.ts");
  const makeMessage = (companyId, externalId, content = { type: "text", text: "original" }, contactPhone = phone) => ({
    companyId, externalId, contactPhone, contactName: "Ada",
    origin: { direction: "incoming", source: "contact" }, sentAt: new Date("2026-01-01T00:00:00Z"), receivedAt: new Date("2026-01-01T00:00:01Z"), content,
  });
  const cleanup = async (companyId) => withTenantIsolation(companyId, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId } });
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
      recordWhatsAppMessage(makeMessage(companyA, `${prefix}-1`)),
      recordWhatsAppMessage(makeMessage(companyA, `${prefix}-2`)),
    ]);
    expect(concurrent.every((result) => result.success && result.data.status === "stored")).toBe(true);
    stage = "second company";
    const otherCompany = await recordWhatsAppMessage(makeMessage(companyB, `${prefix}-other`));
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
    expect(await recordWhatsAppMessage(makeMessage(companyA, `${prefix}-1`, { type: "text", text: "overwrite" }))).toMatchObject({ success: true, data: { status: "duplicate" } });
    await withTenantIsolation(companyA, async () => {
      expect(await prisma.chatMessage.findFirst({ where: { companyId: companyA, externalId: `${prefix}-1` }, select: { text: true } })).toEqual({ text: "original" });
    });

    stage = "image work";
    const image = await recordWhatsAppMessage(makeMessage(companyA, `${prefix}-image`, { type: "image", mediaId: "media-1", caption: null }));
    expect(image.success).toBe(true);
    await withTenantIsolation(companyA, async () => {
      const now = new Date();
      const first = await imageWorkRepository.claimNext({ companyId: companyA, now, leaseUntil: new Date(now.getTime() + 10), claimToken: `${prefix}-claim-1`, maxAttempts: 4 });
      const concurrentClaim = await imageWorkRepository.claimNext({ companyId: companyA, now, leaseUntil: new Date(now.getTime() + 10), claimToken: `${prefix}-claim-concurrent`, maxAttempts: 4 });
      expect(first.success && first.data).toMatchObject({ mediaId: "media-1", attempts: 1, reclaimed: false });
      expect(concurrentClaim).toEqual({ success: true, data: null });
      const reclaimed = await imageWorkRepository.claimNext({ companyId: companyA, now: new Date(now.getTime() + 20), leaseUntil: new Date(now.getTime() + 120_000), claimToken: `${prefix}-claim-2`, maxAttempts: 4 });
      expect(reclaimed.success && reclaimed.data).toMatchObject({ attempts: 2, reclaimed: true, claimToken: `${prefix}-claim-2` });
      expect(await imageWorkRepository.complete({ companyId: companyA, messageId: first.data.messageId, claimToken: first.data.claimToken, completion: { status: "failed", failure: { code: "INVALID_IMAGE", message: "stale worker" } } })).toEqual({ success: true, data: "claim_lost" });
      expect(await imageWorkRepository.complete({ companyId: companyA, messageId: reclaimed.data.messageId, claimToken: reclaimed.data.claimToken, completion: { status: "pending", nextAttemptAt: new Date(now.getTime() + 60_000) } })).toEqual({ success: true, data: "updated" });
    });

    await recordWhatsAppMessage(makeMessage(companyA, `${prefix}-crashed-image`, { type: "image", mediaId: "media-crashed", caption: null }));
    await withTenantIsolation(companyA, async () => {
      const now = new Date();
      const first = await imageWorkRepository.claimNext({ companyId: companyA, now, leaseUntil: new Date(now.getTime() + 10), claimToken: `${prefix}-crash-1`, maxAttempts: 1 });
      expect(first.success && first.data).toMatchObject({ mediaId: "media-crashed", attempts: 1 });
      const exhausted = await imageWorkRepository.claimNext({ companyId: companyA, now: new Date(now.getTime() + 20), leaseUntil: new Date(now.getTime() + 120_000), claimToken: `${prefix}-crash-2`, maxAttempts: 1 });
      expect(exhausted).toEqual({ success: true, data: null });
      expect(await prisma.chatMessage.findFirst({ where: { companyId: companyA, externalId: `${prefix}-crashed-image` }, select: { imageStatus: true, imageFailureCode: true } })).toEqual({ imageStatus: "failed", imageFailureCode: "RETRIES_EXHAUSTED" });
    });

    stage = "rollback";
    await admin.$executeRawUnsafe(`CREATE FUNCTION public.${prefix}_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."companyId" = '${companyA}'::uuid AND NEW."externalId" = '${prefix}-rollback' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER ${prefix}_reject BEFORE INSERT ON public."ChatMessage" FOR EACH ROW EXECUTE FUNCTION public.${prefix}_reject()`);
    try {
      const rolledBack = await recordWhatsAppMessage(makeMessage(companyA, `${prefix}-rollback`, { type: "text", text: "rollback" }, "+14155552672"));
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
