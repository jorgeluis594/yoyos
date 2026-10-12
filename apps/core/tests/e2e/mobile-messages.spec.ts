import { afterAll } from "vitest";
import { app } from "@core/src/app";
import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { registerWhatsAppMessageResponseSchema } from "@shared/contracts/whatsapp-messages";
import { apiErrorResponseSchema } from "@shared/contracts/registration";
import { expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { Page } from "@playwright/test";

const accounts: Array<{ email: string; companyId?: string }> = [];
const nativeId = (accountId: string, chatId: string, whatsappMessageId: string) =>
  `wa-message:v1:${Buffer.from(JSON.stringify([accountId, chatId, whatsappMessageId])).toString("base64url")}`;
const message = (whatsappMessageId = crypto.randomUUID(), content: object = { type: "text", text: " Hola 👋\n" }) => ({
  version: 1,
  message: { id: nativeId("1@lid", "2@lid", whatsappMessageId), accountId: "1@lid", chatId: "2@lid",
    whatsappMessageId, direction: "incoming", timestamp: 1791417600000, content },
});
async function seller(page: Page) {
  const email = `mobile-message-${crypto.randomUUID()}@example.test`;
  const account: { email: string; companyId?: string } = { email };
  accounts.push(account);
  account.companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Mobile messages", country: "PE" });
  return { email, companyId: account.companyId };
}
async function rows(companyId: string) {
  return withTenantIsolation(companyId, async () => await prisma.chatMessage.findMany({ where: { companyId, whatsappMessageId: { not: null } } }));
}
async function checked(response: Awaited<ReturnType<Page["request"]["post"]>>, status: number) {
  expect(response.status()).toBe(status);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return response.json();
}
afterAll(async () => {
  for (const { email, companyId } of accounts) {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.chatMessage.deleteMany({ where: { companyId } });
      await prisma.chat.deleteMany({ where: { companyId } });
      await prisma.contact.deleteMany({ where: { companyId } });
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (companyId) await withTenantIsolation(companyId, async () => await prisma.company.delete({ where: { id: companyId } }));
  }
  await systemPrisma.$disconnect();
});

test("E01–E03 stores text and image, and a lost response repeats the original row", async ({ page }) => {
  const { companyId } = await seller(page);
  const input = message();
  const created = registerWhatsAppMessageResponseSchema.parse(await checked(await page.request.post("/api/messages", { data: input }), 201));
  expect(created).toMatchObject({ status: "stored", eventId: created.messageId });
  expect((await rows(companyId))[0]).toMatchObject({ id: created.messageId, text: " Hola 👋\n", eventDispatchedAt: expect.any(Date) });
  const repeated = registerWhatsAppMessageResponseSchema.parse(await checked(await page.request.post("/api/messages", {
    data: { ...input, message: { ...input.message, content: { type: "text", text: "changed" } } },
  }), 200));
  expect(repeated).toEqual({ ...created, status: "duplicate" });
  expect(await rows(companyId)).toHaveLength(1);
  expect((await rows(companyId))[0].text).toBe(" Hola 👋\n");
  const image = message(crypto.randomUUID(), { type: "image" });
  image.message.direction = "outgoing";
  image.message.timestamp = 0;
  await checked(await page.request.post("/api/messages", { data: image }), 201);
  expect((await rows(companyId)).find(row => row.whatsappMessageId === image.message.whatsappMessageId))
    .toMatchObject({ direction: "outgoing", source: "seller", imageStatus: "metadata_only", imageMimeType: null, imageSize: null, imageId: null });
});

test("E04 and E05 reject unauthorized, malformed and oversized requests without writing", async ({ page, request }) => {
  const input = message();
  expect(apiErrorResponseSchema.parse(await checked(await request.post("/api/messages", { data: input }), 401)).code).toBe("UNAUTHENTICATED");
  const { email, companyId } = await seller(page);
  await systemPrisma.user.update({ where: { email }, data: { emailVerified: false } });
  expect(apiErrorResponseSchema.parse(await checked(await page.request.post("/api/messages", { data: input }), 403)).code).toBe("EMAIL_VERIFICATION_REQUIRED");
  await systemPrisma.user.update({ where: { email }, data: { emailVerified: true, companyId: null } });
  expect(apiErrorResponseSchema.parse(await checked(await page.request.post("/api/messages", { data: input }), 409)).code).toBe("COMPANY_REQUIRED");
  await systemPrisma.user.update({ where: { email }, data: { companyId } });
  for (const [body, headers, status, code] of [
    ["{", { "content-type": "application/json" }, 400, "INVALID_INPUT"],
    ['{"version":1,"version":1}', { "content-type": "application/json" }, 400, "INVALID_INPUT"],
    [JSON.stringify(input), { "content-type": "text/plain" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [JSON.stringify(input), { "content-type": "application/json", "content-encoding": "gzip" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [" ".repeat(102401), { "content-type": "application/json" }, 413, "PAYLOAD_TOO_LARGE"],
  ] as const) expect(apiErrorResponseSchema.parse(await checked(await page.request.post("/api/messages", { data: body, headers }), status)).code).toBe(code);
  expect(apiErrorResponseSchema.parse(await checked(await page.request.post("/api/messages", { data: { ...input, companyId: crypto.randomUUID() } }), 400)).code).toBe("INVALID_INPUT");
  expect(await rows(companyId)).toHaveLength(0);
  const compact = JSON.stringify(input);
  const exact = compact + " ".repeat(102400 - Buffer.byteLength(compact));
  expect(Buffer.byteLength(exact)).toBe(102400);
  await checked(await page.request.post("/api/messages", { data: exact, headers: { "content-type": "application/json" } }), 201);
  expect(await rows(companyId)).toHaveLength(1);
});

test("E04 isolates identical identities between companies", async ({ page }) => {
  const a = await seller(page);
  const input = message();
  const first = registerWhatsAppMessageResponseSchema.parse(await checked(await page.request.post("/api/messages", { data: input }), 201));
  const aUser = await systemPrisma.user.findUniqueOrThrow({ where: { email: a.email } });
  const aRow = (await rows(a.companyId))[0];
  expect(aRow).toMatchObject({ id: first.messageId, eventDispatchedAt: expect.any(Date) });
  await page.request.post("/api/auth/sign-out");
  const b = await seller(page);
  const bUser = await systemPrisma.user.findUniqueOrThrow({ where: { email: b.email } });
  const second = registerWhatsAppMessageResponseSchema.parse(await checked(await page.request.post(
    `/api/messages?companyId=${a.companyId}&userId=${aUser.id}`,
    { data: { ...input, message: { ...input.message, content: { type: "text", text: "Only B" } } },
      headers: { "x-company-id": a.companyId, "x-user-id": aUser.id } },
  ), 201));
  expect(second.messageId).not.toBe(first.messageId);
  expect(await rows(a.companyId)).toEqual([aRow]);
  expect(await rows(b.companyId)).toMatchObject([{ id: second.messageId, companyId: b.companyId, uploadedByUserId: bUser.id, text: "Only B", source: "contact" }]);

  const state = async (companyId: string) => withTenantIsolation(companyId, async () => ({
    contacts: await prisma.contact.findMany({ where: { companyId } }),
    chats: await prisma.chat.findMany({ where: { companyId } }),
    messages: await prisma.chatMessage.findMany({ where: { companyId } }),
  }));
  const before = await Promise.all([state(a.companyId), state(b.companyId)]);
  expect(apiErrorResponseSchema.parse(await checked(await page.request.post("/api/messages", {
    data: { ...input, companyId: a.companyId, userId: aUser.id, source: "seller" },
  }), 400)).code).toBe("INVALID_INPUT");
  expect(await Promise.all([state(a.companyId), state(b.companyId)])).toEqual(before);
});

test("E06 recovers the same committed row after a real provider fails to start", async ({ page }) => {
  const { companyId } = await seller(page);
  const input = message();
  const runtime = globalThis as typeof globalThis & { __yoyosEvents?: ReturnType<typeof createEventBusRuntime> };
  const originalUrl = process.env.EVENT_BUS_DATABASE_URL;
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing dedicated HTTP port");
  const url = `http://127.0.0.1:${address.port}/api/messages`;
  try {
    process.env.EVENT_BUS_DATABASE_URL = "postgresql://core:core@127.0.0.1:1/unavailable";
    runtime.__yoyosEvents = createEventBusRuntime();
    await expect(runtime.__yoyosEvents.provider.start()).rejects.toThrow();
    expect(apiErrorResponseSchema.parse(await checked(await page.request.post(url, { data: input }), 503)).code).toBe("SERVICE_UNAVAILABLE");
    const pending = (await rows(companyId))[0];
    expect(pending.eventDispatchedAt).toBeNull();
    process.env.EVENT_BUS_DATABASE_URL = process.env.DATABASE_URL;
    runtime.__yoyosEvents = createEventBusRuntime();
    await runtime.__yoyosEvents.provider.start();
    const recovered = registerWhatsAppMessageResponseSchema.parse(await checked(await page.request.post(url, { data: input }), 200));
    expect(recovered).toMatchObject({ status: "duplicate", messageId: pending.id, eventId: pending.id, receivedAt: pending.receivedAt.toISOString() });
    expect((await rows(companyId))[0].eventDispatchedAt).toBeInstanceOf(Date);
  } finally {
    await runtime.__yoyosEvents?.provider.stop();
    delete runtime.__yoyosEvents;
    process.env.EVENT_BUS_DATABASE_URL = originalUrl;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("E07 concurrent HTTP requests create one message and preserve Cloud API routes", async ({ page, request }) => {
  const { companyId } = await seller(page);
  const input = message();
  const results = await Promise.all(Array.from({ length: 10 }, () => page.request.post("/api/messages", { data: input })));
  const outputs = await Promise.all(results.map(async response => {
    expect([200, 201]).toContain(response.status());
    expect(response.headers()["cache-control"]).toBe("no-store");
    return registerWhatsAppMessageResponseSchema.parse(await response.json());
  }));
  expect(outputs.filter(output => output.status === "stored")).toHaveLength(1);
  expect(new Set(outputs.map(output => output.messageId)).size).toBe(1);
  expect(await rows(companyId)).toHaveLength(1);
  expect((await request.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=e2e-verify-token&hub.challenge=ok")).status()).toBe(200);
  expect((await page.request.get("/api/orders")).status()).toBe(200);
});
