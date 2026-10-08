import { expect, test } from "vitest";
import { registerWhatsAppMessageRequestSchema, registerWhatsAppMessageResponseSchema } from "@shared/contracts/whatsapp-messages";
import { parseMobileMessage } from "@core/src/features/chats/presentation/mobile-message-schemas";

const nativeId = (account = "1@lid", chat = "2@lid", protocol = "ABC") =>
  `wa-message:v1:${Buffer.from(JSON.stringify([account, chat, protocol])).toString("base64url")}`;
const request = () => ({ version: 1, message: { id: nativeId(), accountId: "1@lid", chatId: "2@lid", whatsappMessageId: "ABC", direction: "incoming", timestamp: 1791417600000, content: { type: "text", text: " Hola 👋\n" } } });
const valid = (value: unknown) => registerWhatsAppMessageRequestSchema.safeParse(value).success;

test("maps native text and image messages without changing identity or content", () => {
  const text = parseMobileMessage(request());
  expect(text).toMatchObject({ externalId: nativeId(), accountId: "1@lid", remoteChatId: "2@lid", whatsappMessageId: "ABC", direction: "incoming", sentAt: new Date(1791417600000), content: { type: "text", text: " Hola 👋\n" } });
  const image = { ...request(), message: { ...request().message, direction: "outgoing", content: { type: "image", caption: " 👋\n", mimeType: "image/jpeg", size: 0 } } };
  expect(parseMobileMessage(image)).toMatchObject({ externalId: nativeId(), direction: "outgoing", content: { type: "image", caption: " 👋\n", mimeType: "image/jpeg", size: 0 } });
  for (const direction of ["incoming", "outgoing"] as const) {
    expect(parseMobileMessage({ ...image, message: { ...image.message, direction } }))
      .toMatchObject({ externalId: nativeId(), direction, content: { type: "image", caption: " 👋\n", mimeType: "image/jpeg", size: 0 } });
    expect(parseMobileMessage({ ...image, message: { ...image.message, direction, content: { type: "image" } } }))
      .toMatchObject({ externalId: nativeId(), accountId: "1@lid", remoteChatId: "2@lid", direction, content: { type: "image", caption: null, mimeType: null, size: null } });
    expect(parseMobileMessage({ ...request(), message: { ...request().message, direction } }))
      .toMatchObject({ direction, content: { type: "text", text: " Hola 👋\n" } });
  }
});

test("maps ReceivedMessage fixtures without sending local delivery or image references", () => {
  const received = { id: nativeId(), accountId: "1@lid", chatId: "2@lid", whatsappMessageId: "ABC", direction: "incoming", timestamp: 0,
    text: " caption 👋\n", deliveryId: "local-delivery", image: { mimeType: "image/png", size: 7, reference: "private-key", localUri: "file:///private" } };
  const { image, text, deliveryId, ...identity } = received;
  void deliveryId;
  const dto = { version: 1, message: { ...identity, content: { type: "image", caption: text, mimeType: image.mimeType, size: image.size } } };
  expect(parseMobileMessage(dto)).toMatchObject({ externalId: received.id, content: { type: "image", caption: text, mimeType: "image/png", size: 7 } });
  expect(JSON.stringify(dto)).not.toMatch(/private-key|local-delivery|file:\/\/\/private|reference|localUri/);
  const textOnly = { version: 1, message: { ...identity, content: { type: "text", text } } };
  expect(parseMobileMessage(textOnly)?.content).toEqual({ type: "text", text });
});

test("rejects unknown, null, mixed, missing and coerced transport fields", () => {
  const base = request();
  for (const candidate of [
    [], { ...base, version: 2 }, { ...base, extra: 1 }, { ...base, message: { ...base.message, extra: 1 } },
    { ...base, message: { ...base.message, content: undefined } },
    { ...base, message: { ...base.message, content: null } }, { ...base, message: { ...base.message, content: { type: "text", text: "" } } },
    { ...base, message: { ...base.message, content: { type: "text", text: "x", caption: "x" } } },
    { ...base, message: { ...base.message, content: { type: "image", caption: null } } },
    { ...base, message: { ...base.message, content: { type: "image", mimeType: null } } },
    { ...base, message: { ...base.message, content: { type: "image", size: null } } },
    { ...base, message: { ...base.message, content: { type: "video" } } },
    { ...base, message: { ...base.message, content: { type: "image", reference: "secret" } } },
    { ...base, message: { ...base.message, timestamp: "1791417600000" } },
  ]) expect(valid(candidate)).toBe(false);
});

test("checks LID and native identity encoding against the exact tuple", () => {
  const base = request();
  expect(valid(base)).toBe(true);
  for (const accountId of ["1@s.whatsapp.net", "1@g.us", "1:2@lid", 1, "1".repeat(125) + "@lid"]) {
    expect(valid({ ...base, message: { ...base.message, accountId } })).toBe(false);
  }
  const exactLid = `${"1".repeat(124)}@lid`;
  expect(valid({ ...base, message: { ...base.message, accountId: exactLid, id: nativeId(exactLid) } })).toBe(true);
  expect(valid({ ...base, message: { ...base.message, accountId: `${"1".repeat(125)}@lid`, id: nativeId(`${"1".repeat(125)}@lid`) } })).toBe(false);
  const escaped = `wa-message:v1:${Buffer.from('["1\\u0040lid","2@lid","ABC"]').toString("base64url")}`;
  expect(valid({ ...base, message: { ...base.message, id: escaped } })).toBe(true);
  const idAt = (length: number) => `wa-message:v1:${Buffer.from(JSON.stringify(["1@lid", "2@lid", "ABC"]) + " ".repeat(length)).toString("base64url")}`;
  const exactId = idAt(3038);
  expect(Buffer.byteLength(exactId)).toBe(4096);
  expect(valid({ ...base, message: { ...base.message, id: exactId } })).toBe(true);
  expect(Buffer.byteLength(idAt(3039))).toBe(4097);
  expect(valid({ ...base, message: { ...base.message, id: idAt(3039) } })).toBe(false);
  const invalidUtf8 = Buffer.concat([Buffer.from('["1@lid","2@lid","'), Buffer.from([0xff]), Buffer.from('"]')]);
  const replacement = { ...base, message: { ...base.message, whatsappMessageId: "�", id: `wa-message:v1:${invalidUtf8.toString("base64url")}` } };
  expect(valid(replacement)).toBe(false);
  for (const id of ["x", "wa-message:v1:", "wa-message:v1:!!!", "wa-message:v1:_w", `${nativeId().slice(0, -1)}1`, nativeId("3@lid"), nativeId("1@lid", "2@lid", "ABCx"),
    `${nativeId()}=`, `wa-message:v1:${Buffer.from('["1@lid","2@lid"]').toString("base64url")}`,
    `wa-message:v1:${Buffer.from('["1@lid","2@lid","ABC","extra"]').toString("base64url")}`,
    `wa-message:v1:${Buffer.from([0xff]).toString("base64url")}`,
    `wa-message:v1:${Buffer.from("{").toString("base64url")}`,
  ]) expect(valid({ ...base, message: { ...base.message, id } })).toBe(false);
});

test("enforces scalar byte boundaries and preserves valid Unicode and whitespace", () => {
  const base = request();
  const accepted = (change: object) => valid({ ...base, message: { ...base.message, ...change } });
  expect(accepted({ whatsappMessageId: "a".repeat(512), id: nativeId("1@lid", "2@lid", "a".repeat(512)) })).toBe(true);
  expect(accepted({ whatsappMessageId: "a".repeat(513), id: nativeId("1@lid", "2@lid", "a".repeat(513)) })).toBe(false);
  expect(accepted({ whatsappMessageId: "😀".repeat(128), id: nativeId("1@lid", "2@lid", "😀".repeat(128)) })).toBe(true);
  expect(accepted({ whatsappMessageId: "😀".repeat(128) + "a", id: nativeId("1@lid", "2@lid", "😀".repeat(128) + "a") })).toBe(false);
  for (const whatsappMessageId of ["\u0000", "\ud800", "\udc00", ""]) expect(accepted({ whatsappMessageId, id: nativeId("1@lid", "2@lid", whatsappMessageId) })).toBe(false);
  expect(accepted({ content: { type: "text", text: "😀".repeat(16384) } })).toBe(true);
  expect(accepted({ content: { type: "text", text: "😀".repeat(16384) + "x" } })).toBe(false);
  for (const text of ["\u0000", "\ud800", "\udc00", ""]) expect(accepted({ content: { type: "text", text } })).toBe(false);
  expect(accepted({ content: { type: "text", text: " \n" } })).toBe(true);
  expect(accepted({ content: { type: "image", caption: "😀".repeat(16384) } })).toBe(true);
  expect(accepted({ content: { type: "image", caption: "😀".repeat(16384) + "x" } })).toBe(false);
  for (const caption of ["\u0000", "\ud800", "\udc00", ""]) expect(accepted({ content: { type: "image", caption } })).toBe(false);
  expect(accepted({ content: { type: "image", mimeType: `image/${"a".repeat(121)}` } })).toBe(true);
  expect(accepted({ content: { type: "image", mimeType: `image/${"a".repeat(122)}` } })).toBe(false);
  for (const size of [0, Number.MAX_SAFE_INTEGER]) expect(accepted({ content: { type: "image", size } })).toBe(true);
  for (const size of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1"]) expect(accepted({ content: { type: "image", size } })).toBe(false);
});

test("accepts safe millisecond endpoints and rejects invalid dates", () => {
  const base = request();
  for (const timestamp of [0, 946684800000, 1791417600000, 253402300799999]) expect(valid({ ...base, message: { ...base.message, timestamp } })).toBe(true);
  for (const timestamp of [-1, 1.5, "0", NaN, Infinity, 253402300800000]) expect(valid({ ...base, message: { ...base.message, timestamp } })).toBe(false);
});

test("response contract is strict", () => {
  const body = { status: "stored", messageId: "00000000-0000-4000-8000-000000000001", eventId: "00000000-0000-4000-8000-000000000001", receivedAt: "2026-10-08T12:00:00.000Z" };
  expect(registerWhatsAppMessageResponseSchema.safeParse(body).success).toBe(true);
  expect(registerWhatsAppMessageResponseSchema.safeParse({ ...body, secret: "x" }).success).toBe(false);
});
