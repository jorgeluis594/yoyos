import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { registerMobileMessage } from "@core/src/features/chats/application/register-mobile-message";
import type { RegisterMobileMessageDependencies } from "@core/src/features/chats/application/register-mobile-message";
import type { ChatMessageId, ImageId, MobileMessageInput, MobileMessage, RegistrationContext } from "@core/src/features/chats/domain/mobile-message";

const companyId = randomUUID() as RegistrationContext["companyId"];
const messageId = randomUUID() as ChatMessageId;
const receivedAt = new Date("2026-10-08T12:00:00.456Z");
const context = { companyId, uploadedByUserId: "uploader", registeredBySessionId: "session" };
const chatId = randomUUID();
const input = { externalId: "native" as MobileMessageInput["externalId"], accountId: "account" as MobileMessageInput["accountId"],
  remoteChatId: "chat" as MobileMessageInput["remoteChatId"], whatsappMessageId: "protocol" as MobileMessageInput["whatsappMessageId"],
  direction: "incoming" as const, sentAt: new Date(0), content: { type: "text" as const, text: "original" } };
const message: MobileMessage = { ...input, ...context, id: messageId, chatId, receivedAt, eventDispatchedAt: null };
const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unavailable" };

function dependencies(created = true, saved = message) {
  return {
    findImage: vi.fn<RegisterMobileMessageDependencies["findImage"]>(async () => ok(true)),
    storeOnce: vi.fn<RegisterMobileMessageDependencies["storeOnce"]>(async () => ok({ created, message: saved })),
    dispatchMessageRecorded: vi.fn<RegisterMobileMessageDependencies["dispatchMessageRecorded"]>(async () => ok(undefined)),
    markEventDispatched: vi.fn<RegisterMobileMessageDependencies["markEventDispatched"]>(async () => ok(undefined)),
    newMessageId: () => randomUUID() as ChatMessageId,
    now: () => receivedAt,
  };
}

const imageId = randomUUID() as ImageId;
const imageInput = { ...input, content: { type: "image" as const, imageId, caption: null } };

test("registers an image message after confirming its imageId exists", async () => {
  const deps = dependencies(true, { ...message, content: { type: "image", imageId, caption: null } });
  expect(await registerMobileMessage(imageInput, context, deps)).toEqual(ok({ status: "stored", messageId, eventId: messageId, receivedAt }));
  expect(deps.findImage).toHaveBeenCalledWith(imageId);
  expect(deps.storeOnce).toHaveBeenCalledWith(expect.objectContaining({ content: imageInput.content }));
});

test("returns IMAGE_NOT_FOUND without storing or publishing when the image does not exist", async () => {
  const deps = dependencies();
  deps.findImage.mockResolvedValue(ok(false));
  expect(await registerMobileMessage(imageInput, context, deps)).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
  expect(deps.storeOnce).not.toHaveBeenCalled();
  expect(deps.dispatchMessageRecorded).not.toHaveBeenCalled();
  deps.findImage.mockResolvedValue(err(failure));
  expect(await registerMobileMessage(imageInput, context, deps)).toEqual(err(failure));
  expect(deps.storeOnce).not.toHaveBeenCalled();
});

test("does not look up images for text messages", async () => {
  const deps = dependencies();
  await registerMobileMessage(input, context, deps);
  expect(deps.findImage).not.toHaveBeenCalled();
});

test("publishes message_created with the chat id and the message id as eventId", async () => {
  const deps = dependencies();
  await registerMobileMessage(input, context, deps);
  expect(deps.dispatchMessageRecorded).toHaveBeenCalledWith({ companyId, chatId, messageId }, expect.objectContaining({ eventId: messageId }));
});

test("publishes only after the store returns its committed row and then marks it", async () => {
  let committed = false;
  const deps = dependencies();
  deps.storeOnce.mockImplementation(async () => { committed = true; return ok({ created: true, message }); });
  deps.dispatchMessageRecorded.mockImplementation(async () => { expect(committed).toBe(true); return ok(undefined); });
  expect(await registerMobileMessage(input, context, deps)).toEqual(ok({ status: "stored", messageId, eventId: messageId, receivedAt }));
  expect(deps.dispatchMessageRecorded).toHaveBeenCalledWith({ companyId, chatId, messageId }, { eventId: messageId, occurredAt: receivedAt.toISOString() });
  expect(deps.markEventDispatched).toHaveBeenCalledWith(companyId, messageId, receivedAt);
  deps.storeOnce.mockResolvedValue(err(failure));
  deps.dispatchMessageRecorded.mockClear();
  expect(await registerMobileMessage(input, context, deps)).toEqual(err(failure));
  expect(deps.dispatchMessageRecorded).not.toHaveBeenCalled();
});

test("confirmed duplicate skips dispatch; pending duplicate uses the original row", async () => {
  const confirmed = dependencies(false, { ...message, eventDispatchedAt: new Date() });
  expect(await registerMobileMessage({ ...input, content: { type: "text", text: "changed" } }, context, confirmed))
    .toEqual(ok({ status: "duplicate", messageId, eventId: messageId, receivedAt }));
  expect(confirmed.dispatchMessageRecorded).not.toHaveBeenCalled();
  const pending = dependencies(false);
  expect(await registerMobileMessage({ ...input, direction: "outgoing", content: { type: "text", text: "changed" } }, context, pending))
    .toEqual(ok({ status: "duplicate", messageId, eventId: messageId, receivedAt }));
  expect(pending.dispatchMessageRecorded).toHaveBeenCalledWith({ companyId, chatId, messageId }, { eventId: messageId, occurredAt: receivedAt.toISOString() });
});

test("dispatch and marker failures leave registration unsuccessful and allow identical retry", async () => {
  const deps = dependencies(false);
  deps.now = () => new Date("2026-10-09T12:00:00.456Z");
  deps.dispatchMessageRecorded.mockResolvedValueOnce(err({ code: "EVENT_BUS_UNAVAILABLE", message: "Unavailable" }));
  expect(await registerMobileMessage(input, context, deps)).toMatchObject({ success: false, error: { code: "EVENT_BUS_UNAVAILABLE" } });
  expect(deps.markEventDispatched).not.toHaveBeenCalled();
  deps.markEventDispatched.mockResolvedValueOnce(err(failure));
  expect(await registerMobileMessage(input, context, deps)).toEqual(err(failure));
  expect(await registerMobileMessage(input, context, deps)).toMatchObject({ success: true, data: { eventId: messageId } });
  expect(deps.dispatchMessageRecorded.mock.calls).toHaveLength(3);
  for (const call of deps.dispatchMessageRecorded.mock.calls) expect(call).toEqual([
    { companyId, chatId, messageId }, { eventId: messageId, occurredAt: receivedAt.toISOString() },
  ]);
});

test("rejects a stored row from another tenant and propagates unexpected exceptions", async () => {
  const deps = dependencies(true, { ...message, companyId: randomUUID() as RegistrationContext["companyId"] });
  expect(await registerMobileMessage(input, context, deps)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(deps.dispatchMessageRecorded).not.toHaveBeenCalled();
  deps.storeOnce.mockRejectedValue(new Error("unexpected"));
  await expect(registerMobileMessage(input, context, deps)).rejects.toThrow("unexpected");
});
