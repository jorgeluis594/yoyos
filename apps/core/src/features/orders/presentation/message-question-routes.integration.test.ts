import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Open questions server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const json = { origin, "content-type": "application/json" };
const password = "test-password-123";
const fixtures: { companyId: string; userId: string }[] = [];
const question = { language: "es", kind: "which_variant", product: "Polo básico", attribute: "Talla", values: ["S", "M", "L"] } as const;
const questionText = "Polo básico: ¿en qué talla, S, M o L?";

async function seller() {
  const companyId = randomUUID();
  const email = `open-questions-${randomUUID()}@example.test`;
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Questions", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: json, body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  fixtures.push({ companyId, userId });
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const run = <T,>(work: () => Promise<T>) => withTenantIsolation(companyId, work);

  const chat = () => run(async () => {
    const contact = await prisma.contact.create({ data: { whatsappAccountId: `${randomUUID()}@lid`, whatsappLid: `${randomUUID()}@lid` } });
    return (await prisma.chat.create({ data: { contactId: contact.id } })).id;
  });
  /** A read message of the chat with its outcomes, read at `readAt`. */
  const message = (chatId: string, outcomes: ChatMessageOutcomes, readAt = new Date("2026-10-31T15:00:00.000Z")) => run(async () => {
    const messageId = randomUUID();
    await prisma.chatMessage.create({ data: { id: messageId, chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "hola", uploadedByUserId: userId, sentAt: readAt, receivedAt: readAt } });
    await prisma.chatMessageOutcome.create({ data: { messageId, outcomes, createdAt: readAt } });
    return messageId;
  });
  const storePendings = (chatId: string, pendingIds: readonly string[], lastRequestAt: Date | null = null) => run(async () => {
    const now = new Date().toISOString();
    const pendings = pendingIds.map((id) => ({ id, subject: { kind: "variant", productId: randomUUID() }, known: {}, quantity: 1, price: null, order: null, lastChangedAt: now,
      sourceMessageId: randomUUID(), requestId: id, doubt: null, pointSince: now, acknowledgedAt: null }));
    await prisma.chatPendings.upsert({ where: { companyId_chatId: { companyId, chatId } }, create: { chatId, pendings, readyRemembered: false, lastRequestAt, updatedAt: new Date() },
      update: { pendings, lastRequestAt, updatedAt: new Date() } });
  });
  const order = (number: number, data: { sellerActedAt?: Date; cancelled?: boolean } = {}) => run(async () => {
    const id = randomUUID();
    await prisma.order.create({ data: { id, number: BigInt(1000 + number), sellerId: userId, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date("2026-10-31T14:00:00.000Z"), ...data } });
    return id;
  });
  return { companyId, cookie, chat, message, storePendings, order, run };
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) {
    await withTenantIsolation(companyId, async () => {
      await prisma.chatPendings.deleteMany();
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

const ask = (cookie: string, messageIds: readonly string[]) =>
  fetch(`${base}/api/messages/questions`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ version: 1, messageIds }) });
const textsOf = async (cookie: string, messageIds: readonly string[]) => {
  const answer = await ask(cookie, messageIds);
  expect(answer.status).toBe(200);
  const body = await answer.json() as { messages: { messageId: string; points: { text: string }[] }[] };
  return Object.fromEntries(body.messages.map((entry) => [entry.messageId, entry.points.map((point) => point.text)]));
};

test("open questions disappear when the pending is completed by a later message", async () => {
  const s = await seller();
  const chatId = await s.chat();
  const pendingId = randomUUID();
  const messageId = await s.message(chatId, [{ kind: "pending_created", pendingId: pendingId as never }, { kind: "questions", questions: [question] }]);
  await s.storePendings(chatId, [pendingId]);

  const open = await ask(s.cookie, [messageId]);
  expect(open.headers.get("cache-control")).toBe("no-store");
  expect(await open.json()).toEqual({ version: 1, messages: [{ messageId, points: [{ id: expect.any(String), text: questionText, about: "Polo básico" }] }] });

  await s.run(async () => { await prisma.chatPendings.deleteMany(); });
  expect(await textsOf(s.cookie, [messageId])).toEqual({});
});

test("an open question without pending disappears after a later order message of the chat", async () => {
  const s = await seller();
  const chatId = await s.chat();
  const messageId = await s.message(chatId, [{ kind: "not_identified", source: "photo", identification: null, silent: false }, { kind: "questions", questions: [{ language: "es", kind: "photo_product_name" }] }]);
  expect(await textsOf(s.cookie, [messageId])).toEqual({ [messageId]: ["¿Me dices el nombre del producto de la foto?"] });

  await s.storePendings(chatId, [], new Date("2026-10-31T15:00:00.000Z"));
  expect(await textsOf(s.cookie, [messageId])).toEqual({ [messageId]: ["¿Me dices el nombre del producto de la foto?"] });

  await s.storePendings(chatId, [], new Date("2026-10-31T15:05:00.000Z"));
  expect(await textsOf(s.cookie, [messageId])).toEqual({});
});

test("an open question without pending disappears after an edit, an undo or a review of the order", async () => {
  const s = await seller();
  const chatId = await s.chat();
  const [untouched, acted, cancelled] = [await s.order(1), await s.order(2, { sellerActedAt: new Date("2026-10-31T15:30:00.000Z") }), await s.order(3, { cancelled: true })];
  const about = (orderId: string) => s.message(chatId, [{ kind: "unclear_item", orderId: orderId as never, namedItem: false, namedProductId: null }, { kind: "questions", questions: [question] }]);
  const [a, b, c] = [await about(untouched), await about(acted), await about(cancelled)];

  expect(await textsOf(s.cookie, [a, b, c])).toEqual({ [a]: [questionText] });
});

test("open questions of another company's message are not returned", async () => {
  const [a, b] = [await seller(), await seller()];
  const messageId = await a.message(await a.chat(), [{ kind: "questions", questions: [question] }]);
  expect(await textsOf(a.cookie, [messageId])).toEqual({ [messageId]: [questionText] });
  expect(await textsOf(b.cookie, [messageId])).toEqual({});
});

test("POST /api/messages/questions refuses a missing session and malformed bodies", async () => {
  const s = await seller();
  expect((await ask("", [randomUUID()])).status).toBe(401);
  expect((await ask(s.cookie, [])).status).toBe(400);
  expect((await ask(s.cookie, Array.from({ length: 101 }, () => randomUUID()))).status).toBe(400);
  expect((await ask(s.cookie, ["not-a-uuid"])).status).toBe(400);
  const broken = await fetch(`${base}/api/messages/questions`, { method: "POST", headers: { ...json, cookie: s.cookie }, body: "{" });
  expect(broken.status).toBe(400);
});
