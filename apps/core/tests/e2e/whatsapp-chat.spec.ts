import { createHmac } from "node:crypto";
import { afterAll } from "vitest";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const companyId = "6b6c7217-c321-4f37-8923-05f4a2549f9c";
const phone = "14155552671";
const prefix = `e2e-${crypto.randomUUID()}`;
afterAll(async () => { await systemPrisma.$disconnect(); });

async function send(request: APIRequestContext, payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", "e2e-app-secret").update(body).digest("hex");
  return request.post("/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` } });
}

test("full server records the seller's first echo and the contact reply exactly once", async ({ request }) => {
  const challenge = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "e2e-verify-token", "hub.challenge": "subscription-ok" });
  expect(await request.get(`/webhooks/whatsapp?${challenge}`).then((response) => response.text())).toBe("subscription-ok");
  const payload = (messages: unknown[], echoes: unknown[] = []) => ({ object: "whatsapp_business_account", entry: [{ id: "e2e-waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: "e2e-phone" }, contacts: [{ wa_id: phone, profile: { name: "Ada" } }], messages, smb_message_echoes: echoes } }] }] });
  const echo = { id: `${prefix}-seller`, to: phone, timestamp: "1767225600", type: "text", text: { body: "hello" } };
  const reply = { id: `${prefix}-contact`, from: phone, timestamp: "1767225601", type: "text", text: { body: " reply " } };
  expect((await send(request, payload([], [echo]))).status()).toBe(200);
  expect((await send(request, payload([reply]))).status()).toBe(200);
  expect((await send(request, payload([reply]))).status()).toBe(200);
  await withTenantIsolation(companyId, async () => {
    const contact = await prisma.contact.findUniqueOrThrow({ where: { companyId_phone: { companyId, phone: `+${phone}` } } });
    const chat = await prisma.chat.findUniqueOrThrow({ where: { companyId_contactId: { companyId, contactId: contact.id } } });
    const messages = await prisma.chatMessage.findMany({ where: { companyId, externalId: { startsWith: prefix } }, orderBy: { sentAt: "asc" } });
    expect(contact.name).toBe("Ada");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ externalId: `${prefix}-seller`, chatId: chat.id, direction: "outgoing", source: "seller", userId: null });
    expect(messages[1]).toMatchObject({ externalId: `${prefix}-contact`, chatId: chat.id, direction: "incoming", source: "contact", text: " reply " });
  });
});
