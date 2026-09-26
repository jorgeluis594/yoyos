import { createHmac } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { whatsappWebhook } from "@core/src/features/chats/presentation/whatsapp-webhook";

const servers: Array<ReturnType<typeof createServer>> = [];
async function listen() {
  const app = express();
  const record = vi.fn(async () => ({ success: true as const, data: { status: "stored" } }));
  const companyId = "7b1d7be7-14bd-4b74-aecd-9fb56d8b64a0";
  app.use("/webhooks/whatsapp", express.raw({ type: "*/*" }), whatsappWebhook([{ companyId, phoneNumberId: "phone-1", businessAccountId: "waba-1", connectedAt: new Date("2026-01-01"), accessToken: "secret" }], "app-secret", "verify-secret", record));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  return { base: `http://127.0.0.1:${address.port}/webhooks/whatsapp`, record, companyId };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe("WhatsApp webhook", () => {
  it("checks the subscription challenge and verifies signatures before parsing", async () => {
    const { base, record } = await listen();
    const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-secret", "hub.challenge": "challenge-123" });
    expect(await fetch(`${base}?${query}`).then(async (response) => [response.status, await response.text()])).toEqual([200, "challenge-123"]);
    expect(await fetch(`${base}?${new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "challenge" })}`)).toHaveProperty("status", 403);
    const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba-1", changes: [
      { field: "messages", value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: "m1", from: "14155552671", timestamp: "1767225600", type: "text", text: { body: "hello" } }] } },
      { field: "smb_message_echoes", value: { metadata: { phone_number_id: "phone-1" }, message_echoes: [{ id: "m2", to: "14155552672", timestamp: "1767225600", type: "text", text: { body: "seller reply" } }] } },
    ] }] });
    const invalid = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" }, body: payload });
    expect(invalid.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
    const signature = createHmac("sha256", "app-secret").update(payload).digest("hex");
    const accepted = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` }, body: payload });
    expect(accepted.status).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: "+14155552671", externalId: "m1" }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: "+14155552672", externalId: "m2", origin: { direction: "outgoing", source: "seller", userId: null } }));
  });
});
