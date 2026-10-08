import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { mobileMessageParser, mobileMessageRoutes, type RegisterMobileMessage } from "@core/src/features/chats/presentation/mobile-message-routes";
import { app as fullApp } from "@core/src/app";
import type { Server } from "node:http";

const id = "00000000-0000-4000-8000-000000000001";
const body = { version: 1, message: { id: "wa-message:v1:WyIxQGxpZCIsIjJAbGlkIiwiQUJDIl0", accountId: "1@lid", chatId: "2@lid", whatsappMessageId: "ABC", direction: "incoming", timestamp: 0, content: { type: "text", text: "hello" } } };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); vi.restoreAllMocks(); });

async function serve(register: RegisterMobileMessage) {
  const app = express();
  app.use("/api/whatsapp/messages", mobileMessageParser);
  app.use((_request, response, next) => { response.locals.auth = { status: "ready", company: { id }, user: { id: "u1" } }; next(); });
  app.use("/api/whatsapp/messages", mobileMessageRoutes(register));
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return `http://127.0.0.1:${address.port}/api/whatsapp/messages`;
}

test("factory returns validated stored and duplicate responses with trusted context", async () => {
  const register = vi.fn<RegisterMobileMessage>().mockResolvedValue({ success: true, data: { status: "stored", messageId: id as never, eventId: id as never, receivedAt: new Date(0) } });
  const url = await serve(register);
  const call = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const created = await call();
  expect(created.status).toBe(201);
  expect(created.headers.get("cache-control")).toBe("no-store");
  expect(await created.json()).toEqual({ status: "stored", messageId: id, eventId: id, receivedAt: "1970-01-01T00:00:00.000Z" });
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ externalId: body.message.id, accountId: "1@lid", remoteChatId: "2@lid", sentAt: new Date(0) }), { companyId: id, uploadedByUserId: "u1" });
  register.mockResolvedValueOnce({ success: true, data: { status: "duplicate", messageId: id as never, eventId: id as never, receivedAt: new Date(0) } });
  expect((await call()).status).toBe(200);
});

test("parser rejects malformed, duplicate, compressed, oversized and wrong media before effects", async () => {
  const register = vi.fn<RegisterMobileMessage>();
  const url = await serve(register);
  for (const [payload, headers, status, reason] of [
    ["{", { "content-type": "application/json" }, 400, "INVALID_JSON"],
    ['{"version":1,"message":{"id":"x","id":"y"}}', { "content-type": "application/json" }, 400, "DUPLICATE_KEY"],
    [JSON.stringify(body), { "content-type": "text/plain" }, 415, null],
    [JSON.stringify(body), { "content-type": "application/json", "content-encoding": "gzip" }, 415, null],
    [JSON.stringify({ ...body, extra: "x".repeat(102400) }), { "content-type": "application/json" }, 413, null],
  ] as const) {
    const response = await fetch(url, { method: "POST", headers, body: payload });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const error = await response.json();
    if (reason) expect(error.issues).toContainEqual({ field: "body", reason });
  }
  expect(register).not.toHaveBeenCalled();
  const invalidUtf8 = Buffer.concat([Buffer.from(JSON.stringify(body).replace("hello", "")), Buffer.from([0xff])]);
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: invalidUtf8 });
  expect(response.status).toBe(400);
  expect((await response.json()).issues).toContainEqual({ field: "body", reason: "INVALID_JSON" });
});

test("the byte limit admits exactly 102400 bytes", async () => {
  const register = vi.fn<RegisterMobileMessage>().mockResolvedValue({ success: true, data: { status: "stored", messageId: id as never, eventId: id as never, receivedAt: new Date(0) } });
  const url = await serve(register);
  const compact = JSON.stringify(body);
  const exact = compact + " ".repeat(102400 - Buffer.byteLength(compact));
  expect(Buffer.byteLength(exact)).toBe(102400);
  expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: exact })).status).toBe(201);
  expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: exact + " " })).status).toBe(413);
  expect(register).toHaveBeenCalledOnce();
});

test("declared temporary and stored-data failures map to sanitized statuses", async () => {
  const register = vi.fn<RegisterMobileMessage>();
  const url = await serve(register);
  for (const [code, status] of [["PERSISTENCE_UNAVAILABLE", 503], ["EVENT_BUS_UNAVAILABLE", 503], ["INVALID_STORED_DATA", 500], ["INVALID_EVENT", 500]] as const) {
    register.mockResolvedValueOnce({ success: false, error: { code, message: "private SQL token" } });
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("private SQL token");
  }
});

test("validation and invalid output return sanitized errors without invoking untrusted operations", async () => {
  const register = vi.fn<RegisterMobileMessage>().mockResolvedValue({ success: true, data: { status: "stored", messageId: "invalid" as never, eventId: id as never, receivedAt: new Date(0) } });
  const url = await serve(register);
  const invalid = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, message: { ...body.message, content: { type: "text", text: "secret", reference: "very-secret" } } }) });
  expect(invalid.status).toBe(400);
  expect(JSON.stringify(await invalid.json())).not.toContain("very-secret");
  expect(register).not.toHaveBeenCalled();
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "INTERNAL_ERROR", error: "Internal error" });
});

test("full app parses WhatsApp JSON before authentication without enabling the route", async () => {
  const server = fullApp.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/whatsapp/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
