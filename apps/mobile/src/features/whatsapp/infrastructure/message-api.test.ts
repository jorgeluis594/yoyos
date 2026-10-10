import { err, ok } from "@shared/functional";
import { registerWhatsAppMessageRequestSchema } from "@shared/contracts/whatsapp-messages";
import { createMessageApi, toRegisterRequest } from "@mobile/features/whatsapp/infrastructure/message-api";
import type { ImageDownloadReference, NativeMessageId } from "@mobile/features/whatsapp/domain/ids";
import type { InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";

const identity = Buffer.from(JSON.stringify(["1@lid", "2@lid", "ABC"])).toString("base64url");
const text: InboundMessage = {
  id: `wa-message:v1:${identity}` as NativeMessageId, accountId: "1@lid" as never, chatId: "2@lid" as never, whatsappMessageId: "ABC" as never,
  direction: "incoming", sentAt: new Date(1_700_000_000_000), content: { type: "text", text: "hello" },
};
const image: InboundMessage = { ...text, content: { type: "image", caption: "cap", mimeType: "image/png", size: 12, reference: "wa-image:v1:SECRET" as ImageDownloadReference } };
const coreId = "00000000-0000-4000-8000-000000000001";
const response = { status: "stored", messageId: coreId, eventId: coreId, receivedAt: "2026-10-10T00:00:00.000Z" };

test("builds a text request that passes registerWhatsAppMessageRequestSchema", () => {
  expect(registerWhatsAppMessageRequestSchema.safeParse(toRegisterRequest(text)).success).toBe(true);
});

test("builds an image request with only caption, mimeType and size", () => {
  const request = toRegisterRequest(image);
  expect(request.message.content).toEqual({ type: "image", caption: "cap", mimeType: "image/png", size: 12 });
  expect(toRegisterRequest({ ...image, content: { ...image.content, caption: null, mimeType: null, size: null } as never }).message.content).toEqual({ type: "image" });
});

test("never includes the image download reference, deliveryId or local URIs", () => {
  expect(JSON.stringify(toRegisterRequest(image))).not.toMatch(/SECRET|wa-image|deliveryId|file:\/\//);
});

test("sends sentAt as Unix milliseconds", () => {
  expect(toRegisterRequest(text).message.timestamp).toBe(1_700_000_000_000);
});

test("omits the timestamp when sentAt is null instead of inventing a date", () => {
  const request = toRegisterRequest({ ...text, sentAt: null });
  expect("timestamp" in request.message).toBe(false);
  expect(registerWhatsAppMessageRequestSchema.safeParse(request).success).toBe(true);
});

test("posts the request to /api/messages", async () => {
  const request = jest.fn(async (_path: string, _init?: RequestInit) => ok<unknown>(response));
  await createMessageApi(request).register(text);
  expect(request).toHaveBeenCalledTimes(1);
  const [path, init] = request.mock.calls[0] ?? [];
  expect(path).toBe("/api/messages");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body))).toEqual(toRegisterRequest(text));
});

test("returns stored for 201 and duplicate for 200 responses", async () => {
  expect(await createMessageApi(async () => ok<unknown>(response)).register(text)).toEqual({ success: true, data: { status: "stored", messageId: coreId } });
  expect(await createMessageApi(async () => ok<unknown>({ ...response, status: "duplicate" })).register(text)).toMatchObject({ data: { status: "duplicate" } });
});

test("returns INVALID_RESPONSE when the body fails registerWhatsAppMessageResponseSchema", async () => {
  expect(await createMessageApi(async () => ok<unknown>({ status: "stored" })).register(text)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("passes transport errors through with their codes", async () => {
  for (const [code, status] of [["API_ERROR", 400], ["UNAUTHENTICATED", 401], ["API_ERROR", 403], ["API_ERROR", 413], ["UNSUPPORTED_MEDIA_TYPE", 415],
    ["RATE_LIMITED", 429], ["SERVER_ERROR", 500], ["SERVICE_UNAVAILABLE", 503]] as const) {
    const failure = { code, message: "m", http: { status, body: {} } };
    expect(await createMessageApi(async () => err(failure)).register(text)).toEqual({ success: false, error: failure });
  }
});

test("returns NETWORK_ERROR when the request cannot be sent", async () => {
  expect(await createMessageApi(async () => err({ code: "NETWORK_ERROR", message: "x" })).register(text)).toMatchObject({ error: { code: "NETWORK_ERROR" } });
});
