import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createSendChatMessageNoticeHandler } from "@core/src/features/notifications/composition";
import type { NoticeLocale, PushDevice } from "@core/src/features/notifications/domain/push-device";
import type { RenderedNotice } from "@core/src/features/notifications/application/send-chat-message-notice";
import type { ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const chatId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Notices", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId: contact.id } });
  });
  const addMessage = (outcomes: ChatMessageOutcomes) => withTenantIsolation(companyId, async () => {
    const messageId = randomUUID();
    await prisma.chatMessage.create({ data: { id: messageId, chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "hola", uploadedByUserId: sellerId, registeredBySessionId: "session-1", sentAt: new Date(), receivedAt: new Date() } });
    await prisma.chatMessageOutcome.create({ data: { messageId, outcomes } });
    return messageId;
  });
  const addOrder = (number: number) => withTenantIsolation(companyId, async () => {
    const id = randomUUID();
    await prisma.order.create({ data: { id, number: BigInt(number), sellerId, chatId, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date() } });
    return id;
  });
  return { companyId, chatId, addMessage, addOrder, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.chatMessageOutcome.deleteMany();
      await prisma.chatMessage.deleteMany();
      await prisma.order.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function handlerFor(locale: NoticeLocale, sendResults: Array<"ok" | "unavailable"> = []) {
  const sent: RenderedNotice[] = [];
  const lookups: unknown[][] = [];
  const device = { id: "device-1", sessionId: "session-1", userId: "user-1", token: "ExponentPushToken[a]", platform: "ios", locale } as unknown as PushDevice;
  const handler = createSendChatMessageNoticeHandler({
    findDeviceForSession: async (...args) => { lookups.push(args); return ok(device); },
    sendPush: async (_device, notice) => {
      if (sendResults.shift() === "unavailable") return err({ code: "PROVIDER_UNAVAILABLE", message: "down", retryable: true });
      sent.push(notice);
      return ok(null);
    },
    removeDevice: async () => ok(null),
  });
  const run = (f: Fixture, messageId: string, attempt = 1) => handler({ companyId: f.companyId as never, messageId: messageId as never },
    { eventId: messageId, occurredAt: new Date().toISOString() }, { signal: new AbortController().signal, attempt });
  return { run, sent, lookups };
}

const notIdentified: ChatMessageOutcomes = [{ kind: "not_identified", source: "photo", identification: null, silent: false }];

test("sends one push with the product draft's Spanish text, the message data and the chat as group key", async () => {
  const f = await fixture();
  try {
    const messageId = await f.addMessage(notIdentified);
    const { run, sent, lookups } = handlerFor("es");
    expect(await run(f, messageId)).toEqual(ok(undefined));
    expect(sent).toEqual([{
      title: "Producto no reconocido",
      body: "Un cliente envió una foto que no coincide con tu catálogo. Revisa el chat.",
      data: { v: 1, companyId: f.companyId, messageId, target: "message" },
      groupKey: f.chatId,
    }]);
    expect(lookups).toEqual([["session-1", f.companyId]]);
  } finally { await f.cleanup(); }
});

test("sends nothing for a repeated event", async () => {
  const f = await fixture();
  try {
    const messageId = await f.addMessage(notIdentified);
    const { run, sent } = handlerFor("es");
    await run(f, messageId);
    expect(await run(f, messageId, 2)).toEqual(ok(undefined));
    expect(sent).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("sends pt-BR texts to a pt-BR device", async () => {
  const f = await fixture();
  try {
    const messageId = await f.addMessage(notIdentified);
    const { run, sent } = handlerFor("pt-BR");
    await run(f, messageId);
    expect(sent[0]).toMatchObject({ title: "Produto não reconhecido", body: "Um cliente enviou uma foto que não corresponde ao seu catálogo. Veja o chat." });
  } finally { await f.cleanup(); }
});

test("names the order from the notice's ids and opens the order for an order notice", async () => {
  const f = await fixture();
  try {
    const earlier = await f.addOrder(1023);
    const current = await f.addOrder(1024);
    const unclear = await f.addMessage([{ kind: "unclear_item", orderId: earlier as never, namedItem: false, namedProductId: null }]);
    const ready = await f.addMessage([{ kind: "ready", orderId: current as never }]);
    const { run, sent } = handlerFor("es");
    await run(f, unclear);
    await run(f, ready);
    expect(sent[0]?.body).toBe("Un cliente pidió quitar o cambiar un producto del pedido #1023, pero no sabemos cuál.");
    expect(sent[1]).toMatchObject({ title: "Pedido #1024 listo", data: { target: "order", messageId: ready } });
  } finally { await f.cleanup(); }
});

test("releases the claim when the provider is unavailable so the retry sends the notice", async () => {
  const f = await fixture();
  try {
    const messageId = await f.addMessage(notIdentified);
    const { run, sent } = handlerFor("es", ["unavailable", "ok"]);
    expect(await run(f, messageId)).toMatchObject({ success: false, error: { code: "PROVIDER_UNAVAILABLE", retryable: true } });
    expect(sent).toHaveLength(0);
    expect(await run(f, messageId, 2)).toEqual(ok(undefined));
    expect(sent).toHaveLength(1);
  } finally { await f.cleanup(); }
});
