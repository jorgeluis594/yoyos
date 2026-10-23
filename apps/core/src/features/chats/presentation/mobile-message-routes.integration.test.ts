import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { expect, test, vi } from "vitest";
import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { registerMobileMessage } from "@core/src/features/chats/register-mobile-message";
import { mobileMessageParser, mobileMessageRoutes } from "@core/src/features/chats/presentation/mobile-message-routes";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const events = globalThis as typeof globalThis & { __yoyosEvents?: ReturnType<typeof createEventBusRuntime> };
const nativeId = (protocol: string) => `wa-message:v1:${Buffer.from(JSON.stringify(["123@lid", "456@lid", protocol])).toString("base64url")}`;

test("POST /api/messages stores the registering session and publishes message_created with the chat id", async () => {
  const companyId = randomUUID();
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Registering session", country: "PE" } }));
  const runtime = createEventBusRuntime();
  events.__yoyosEvents = runtime;
  await runtime.provider.start();
  const publish = vi.spyOn(runtime.provider, "publish");
  let sessionId = "session-1";
  const app = express();
  app.use((_request, response, next) => { response.locals.auth = { status: "ready", company: { id: companyId }, user: { id: "test-user" }, sessionId }; next(); });
  app.use("/api/messages", mobileMessageParser, mobileMessageRoutes(registerMobileMessage));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const post = () => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/messages`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, message: { id: nativeId("session"), accountId: "123@lid", chatId: "456@lid", whatsappMessageId: "session",
      direction: "incoming", timestamp: 1791417600123, content: { type: "text", text: "hola" } } }) });
  try {
    const created = await post();
    expect(created.status).toBe(201);
    const { messageId } = await created.json() as { messageId: string };
    const row = await withTenantIsolation(companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { companyId } }));
    expect(row).toMatchObject({ id: messageId, registeredBySessionId: "session-1" });
    expect(publish).toHaveBeenCalledWith("message_created", { companyId, chatId: row.chatId, messageId }, expect.objectContaining({ eventId: messageId }));
    sessionId = "session-2";
    expect((await post()).status).toBe(200);
    expect(await withTenantIsolation(companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { companyId } })))
      .toMatchObject({ id: messageId, registeredBySessionId: "session-1" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await runtime.provider.stop();
    delete events.__yoyosEvents;
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try { await pool.query("DELETE FROM pgboss.job WHERE data->>'name' = 'message_created' AND data->'payload'->>'companyId' = $1", [companyId]); }
    finally { await pool.end(); }
    await withTenantIsolation(companyId, async () => {
      await prisma.chatMessage.deleteMany({ where: { companyId } });
      await prisma.chat.deleteMany({ where: { companyId } });
      await prisma.contact.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
});
