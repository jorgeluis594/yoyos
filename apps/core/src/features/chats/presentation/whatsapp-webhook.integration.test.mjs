import { createHmac } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "vitest";

test("signed webhook records both directions, observes connection cutoff, and recovers a partial batch", async () => {
  const appUrl = process.env.DATABASE_URL;
  expect(appUrl, "run sh scripts/run-tests.sh integration to prepare core_test").toBeTruthy();
  const adminUrl = new URL(appUrl);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  const companyId = crypto.randomUUID();
  const prefix = `webhook_${crypto.randomUUID().replaceAll("-", "")}`;
  const phone = "14155552671";
  const connectedAt = new Date("2026-01-01T00:00:00Z");
  const { prisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
  const { whatsappWebhook } = await import("@core/src/features/chats/presentation/whatsapp-webhook.ts");
  const app = express();
  app.use("/webhooks/whatsapp", express.raw({ type: "*/*" }), whatsappWebhook([{ companyId, phoneNumberId: "phone-1", businessAccountId: "waba-1", connectedAt, accessToken: "test-token" }], "test-app-secret", "test-verify-token"));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/webhooks/whatsapp`;
  const post = async (payload, signed = true) => {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", "test-app-secret").update(body).digest("hex");
    return fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signed ? `sha256=${signature}` : "sha256=bad" }, body });
  };
  const batch = (messages = [], echoes = [], account = "waba-1") => ({ object: "whatsapp_business_account", entry: [{ id: account, changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-1" }, contacts: [{ wa_id: phone, profile: { name: "Ada" } }], messages, smb_message_echoes: echoes } }] }] });
  const text = (id, timestamp, body = "text") => ({ id: `${prefix}-${id}`, from: phone, timestamp: String(timestamp), type: "text", text: { body } });
  const echo = (id, timestamp, body = "reply") => ({ id: `${prefix}-${id}`, to: phone, timestamp: String(timestamp), type: "text", text: { body } });
  const cleanup = () => withTenantIsolation(companyId, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId } });
    await prisma.chat.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  try {
    await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Webhook test", country: "PE" } }));
    const challenge = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "abc" });
    expect(await fetch(`${url}?${challenge}`).then(async (response) => [response.status, await response.text()])).toEqual([200, "abc"]);
    expect((await post(batch([text("bad-signature", 1_767_225_600)]), false)).status).toBe(401);
    expect((await post(batch([text("before", 1_767_225_599)]))).status).toBe(200);
    expect((await post(batch([], [echo("seller-first", 1_767_225_600)]))).status).toBe(200);
    expect((await post(batch([text("contact-reply", 1_767_225_601, " reply ")]))).status).toBe(200);
    expect((await post(batch([text("contact-reply", 1_767_225_601, "changed")]))).status).toBe(200);
    await withTenantIsolation(companyId, async () => {
      const contact = await prisma.contact.findUnique({ where: { companyId_phone: { companyId, phone: `+${phone}` } } });
      const chat = await prisma.chat.findUnique({ where: { companyId_contactId: { companyId, contactId: contact.id } } });
      const messages = await prisma.chatMessage.findMany({ where: { companyId }, orderBy: { sentAt: "asc" } });
      expect(contact.name).toBe("Ada");
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ externalId: `${prefix}-seller-first`, direction: "outgoing", source: "seller", userId: null, chatId: chat.id });
      expect(messages[1]).toMatchObject({ externalId: `${prefix}-contact-reply`, direction: "incoming", source: "contact", text: " reply ", chatId: chat.id });
    });

    await admin.$executeRawUnsafe(`CREATE FUNCTION public.${prefix}_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."externalId" = '${prefix}-partial-2' THEN RAISE EXCEPTION 'injected temporary failure'; END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER ${prefix}_reject BEFORE INSERT ON public."ChatMessage" FOR EACH ROW EXECUTE FUNCTION public.${prefix}_reject()`);
    try {
      const partial = batch([text("partial-1", 1_767_225_602), text("partial-2", 1_767_225_603)]);
      expect((await post(partial)).status).toBe(503);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER ${prefix}_reject ON public."ChatMessage"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION public.${prefix}_reject()`);
    }
    const retried = batch([text("partial-1", 1_767_225_602), text("partial-2", 1_767_225_603)]);
    expect((await post(retried)).status).toBe(200);
    await withTenantIsolation(companyId, async () => {
      expect(await prisma.chatMessage.count({ where: { companyId } })).toBe(4);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup();
    await admin.$disconnect();
  }
});
