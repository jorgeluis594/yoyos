import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Seller notice server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const json = { origin, "content-type": "application/json" };
const password = "test-password-123";
const fixtures: { companyId: string; userId: string }[] = [];

async function seller() {
  const companyId = randomUUID();
  const email = `seller-notice-${randomUUID()}@example.test`;
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Notices", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: json, body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  fixtures.push({ companyId, userId });
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const messageWith = (outcomes: ChatMessageOutcomes) => withTenantIsolation(companyId, async () => {
    const contact = await prisma.contact.create({ data: { whatsappAccountId: `${randomUUID()}@lid`, whatsappLid: `${randomUUID()}@lid` } });
    const chat = await prisma.chat.create({ data: { contactId: contact.id } });
    const messageId = randomUUID();
    await prisma.chatMessage.create({ data: { id: messageId, chatId: chat.id, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "hola", uploadedByUserId: userId, sentAt: new Date(), receivedAt: new Date() } });
    await prisma.chatMessageOutcome.create({ data: { messageId, outcomes } });
    return messageId;
  });
  const orderWithNumber = (number: number) => withTenantIsolation(companyId, async () => {
    const id = randomUUID();
    await prisma.order.create({ data: { id, number: BigInt(number), sellerId: userId, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date() } });
    return id;
  });
  return { companyId, userId, cookie, messageWith, orderWithNumber };
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) {
    await withTenantIsolation(companyId, async () => {
      await prisma.chatMessageOutcome.deleteMany();
      await prisma.chatMessage.deleteMany();
      await prisma.order.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
    });
    await systemPrisma.user.delete({ where: { id: userId } });
    await withTenantIsolation(companyId, async () => await prisma.company.delete({ where: { id: companyId } }));
  }
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const get = (cookie: string, messageId: string) => fetch(`${base}/api/seller-notices/${messageId}`, { headers: { cookie } });

test("GET /api/seller-notices/:messageId returns the order of an order notice and 404 for another company or a deleted order", async () => {
  const [a, b] = [await seller(), await seller()];
  const orderId = await a.orderWithNumber(1023);
  const ready = await a.messageWith([{ kind: "ready", orderId: orderId as never }]);

  const found = await get(a.cookie, ready);
  expect(found.status).toBe(200);
  expect(found.headers.get("cache-control")).toBe("no-store");
  expect(await found.json()).toEqual({ version: 1, target: { kind: "order", orderId } });

  expect((await get(b.cookie, ready)).status).toBe(404);
  expect(await (await get(b.cookie, ready)).json()).toMatchObject({ code: "NOTICE_NOT_FOUND" });

  await withTenantIsolation(a.companyId, async () => { await prisma.order.delete({ where: { id: orderId } }); });
  expect((await get(a.cookie, ready)).status).toBe(404);
});

test("GET /api/seller-notices/:messageId opens the message for a problem notice and finds nothing for a silent message", async () => {
  const user = await seller();
  const problem = await user.messageWith([{ kind: "variant_missing", productId: randomUUID() as never, identification: null }]);
  const silent = await user.messageWith([{ kind: "no_intent" }]);
  expect(await (await get(user.cookie, problem)).json()).toEqual({ version: 1, target: { kind: "message" } });
  expect((await get(user.cookie, silent)).status).toBe(404);
  expect((await get(user.cookie, randomUUID())).status).toBe(404);
});

test("GET /api/seller-notices/:messageId rejects an invalid id and an anonymous caller", async () => {
  const user = await seller();
  expect((await get(user.cookie, "not-a-uuid")).status).toBe(400);
  expect((await get("", randomUUID())).status).toBe(401);
});
