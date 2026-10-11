import { fromReceivedMessage, type ReceivedMessageData } from "@mobile/features/whatsapp/domain/inbound-message";

const base: ReceivedMessageData = {
  id: "wa-message:v1:WyIxQGxpZCIsIjJAbGlkIiwiQUJDIl0",
  accountId: "1@lid",
  chatId: "2@lid",
  whatsappMessageId: "ABC",
  direction: "incoming",
  timestamp: 1_700_000_000_000,
  text: "hello",
};
const image = { mimeType: "image/jpeg", size: 10, reference: { messageId: "m", downloadReference: "wa-image:v1:secret" } };

test("maps a text message to text content with branded ids and direction", () => {
  expect(fromReceivedMessage(base)).toEqual({
    success: true,
    data: { id: base.id, accountId: "1@lid", chatId: "2@lid", whatsappMessageId: "ABC", direction: "incoming", sentAt: new Date(1_700_000_000_000), content: { type: "text", text: "hello" } },
  });
});

test("maps an image with text to image content using the text as caption", () => {
  const result = fromReceivedMessage({ ...base, image });
  expect(result).toMatchObject({ success: true, data: { content: { type: "image", caption: "hello", mimeType: "image/jpeg", size: 10, reference: "wa-image:v1:secret" } } });
});

test("maps an image without text to a null caption", () => {
  const { text: _text, ...withoutText } = base;
  expect(fromReceivedMessage({ ...withoutText, image })).toMatchObject({ success: true, data: { content: { type: "image", caption: null } } });
});

test("keeps null mime type and size when the image omits them", () => {
  expect(fromReceivedMessage({ ...base, image: { reference: image.reference } })).toMatchObject({ success: true, data: { content: { mimeType: null, size: null } } });
});

test("sets sentAt to null when the timestamp is missing instead of using the arrival time", () => {
  const { timestamp: _timestamp, ...withoutTimestamp } = base;
  expect(fromReceivedMessage(withoutTimestamp)).toMatchObject({ success: true, data: { sentAt: null } });
});

test("returns EMPTY_MESSAGE when there is neither text nor image", () => {
  const { text: _text, ...withoutText } = base;
  expect(fromReceivedMessage(withoutText)).toMatchObject({ success: false, error: { code: "EMPTY_MESSAGE" } });
  expect(fromReceivedMessage({ ...base, text: "" })).toMatchObject({ success: false, error: { code: "EMPTY_MESSAGE" } });
});

test("returns INVALID_ID when accountId or chatId is not a LID", () => {
  expect(fromReceivedMessage({ ...base, accountId: "1@s.whatsapp.net" })).toMatchObject({ success: false, error: { code: "INVALID_ID" } });
  expect(fromReceivedMessage({ ...base, chatId: "2@g.us" })).toMatchObject({ success: false, error: { code: "INVALID_ID" } });
});
