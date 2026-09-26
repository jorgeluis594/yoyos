import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import { parseWhatsAppWebhook } from "@core/src/features/chats/presentation/whatsapp-schemas";
import type { WhatsAppConnection } from "@core/src/features/chats/infrastructure/whatsapp-connections";
import { recordWhatsAppMessage } from "@core/src/features/chats";
import type { RecordMessageInput } from "@core/src/features/chats/domain/message";
import type { Result } from "@shared/result";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

export function whatsappWebhook(connections: readonly WhatsAppConnection[], appSecret: string, verifyToken: string, record: (input: RecordMessageInput, connection: WhatsAppConnection) => Promise<Result<unknown>> = recordWhatsAppMessage) {
  const router = express.Router();
  router.get("/", (request, response) => {
    if (!verifyToken || request.query["hub.mode"] !== "subscribe" || request.query["hub.verify_token"] !== verifyToken || typeof request.query["hub.challenge"] !== "string") return response.sendStatus(403);
    return response.type("text/plain").send(request.query["hub.challenge"]);
  });
  router.post("/", async (request, response) => {
    if (!Buffer.isBuffer(request.body) || !appSecret) return response.sendStatus(400);
    const signature = request.header("x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", appSecret).update(request.body).digest("hex")}`;
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return response.sendStatus(401);
    let body: unknown;
    try { body = JSON.parse(request.body.toString("utf8")); } catch { return response.sendStatus(400); }
    const batch = parseWhatsAppWebhook(body);
    if (!batch) return response.sendStatus(400);
    let rejected = batch.malformed > 0;
    let unavailable = false;
    for (const event of batch.events) {
      if (event.status === "ignored") continue;
      const connection = connections.find(({ phoneNumberId }) => phoneNumberId === event.phoneNumberId);
      if (!connection || connection.businessAccountId !== event.businessAccountId) { rejected = true; continue; }
      if (event.message.sentAt < connection.connectedAt) continue;
      const saved = await withTenantIsolation(connection.companyId, () => record({ ...event.message, receivedAt: new Date() }, connection));
      if (!saved.success) {
        if (saved.error.code === "INVALID_MESSAGE" || saved.error.code === "INVALID_CONTACT") rejected = true;
        else unavailable = true;
        console.error("Unable to record WhatsApp webhook message", { code: saved.error.code });
      }
    }
    return response.sendStatus(rejected ? 400 : unavailable ? 503 : 200);
  });
  return router;
}
