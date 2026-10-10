import { ok } from "@shared/functional";
import { createWhatsAppRuntime } from "@mobile/features/whatsapp/composition";
import type { WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import { migrateWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";
import { openTestDatabase } from "@mobile/features/whatsapp/infrastructure/node-sqlite-database";

test("a linked account receives, stores, confirms and syncs a message end to end", async () => {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  const listeners: Record<string, (payload: never) => void> = {};
  const confirmed: string[] = [];
  const gateway = {
    initialize: async () => ok(undefined), connect: async () => ok(undefined), disconnect: async () => ok(undefined), logout: async () => ok(undefined),
    confirmMessageStored: async (id: string) => { confirmed.push(id); return ok(undefined); },
    downloadImage: async () => ok({ uri: "file:///x", mimeType: "image/png", size: 1 }), deleteDownloadedImage: async () => ok(undefined),
    addListener: (name: string, listener: (payload: never) => void) => { listeners[name] = listener; return { remove: () => undefined }; },
  } as unknown as WhatsAppGateway;
  const requests: string[] = [];
  let ids = 0;
  const runtime = createWhatsAppRuntime({
    database, gateway, generation: () => 1, newId: () => `link-${++ids}`, now: () => new Date(5000), random: () => 0.5, schedule: () => () => undefined,
    request: async (path) => { requests.push(path); return ok({ status: "stored", messageId: "00000000-0000-4000-8000-000000000001", eventId: "00000000-0000-4000-8000-000000000002", receivedAt: "2026-10-10T00:00:00.000Z" }); },
  });

  expect(await runtime.linkAccount()).toMatchObject({ success: false, error: { code: "NO_SESSION" } });
  runtime.setIdentity({ companyId: "c1", userId: "u1" });
  expect(await runtime.linkAccount()).toMatchObject({ success: true });

  const identity = Buffer.from(JSON.stringify(["1@lid", "2@lid", "W1"])).toString("base64url");
  (listeners.messageReceived as (payload: unknown) => void)({
    deliveryId: "wa-delivery:v1:" + "a".repeat(32),
    message: { id: `wa-message:v1:${identity}`, accountId: "1@lid", chatId: "2@lid", whatsappMessageId: "W1", direction: "incoming", text: "hola", timestamp: 1000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(confirmed).toHaveLength(1);
  expect(requests).toEqual(["/api/messages"]);
  expect(await runtime.store.listConversations("c1" as never)).toMatchObject({ data: [{ chatId: "2@lid", unsynced: 0 }] });
  database.close();
});
