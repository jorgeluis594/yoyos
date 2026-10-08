import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { registerMobileMessage } from "@core/src/features/chats/application/register-mobile-message";
import type { RegisterMobileMessageDependencies } from "@core/src/features/chats/application/register-mobile-message";
import type { ChatMessageId, MobileMessageInput, MobileMessage, RegistrationContext } from "@core/src/features/chats/domain/mobile-message";

const companyId = randomUUID() as RegistrationContext["companyId"];
const messageId = randomUUID() as ChatMessageId;
const receivedAt = new Date("2026-10-08T12:00:00.456Z");
const context = { companyId, uploadedByUserId: "uploader" };
const input = { externalId: "native" as MobileMessageInput["externalId"], accountId: "account" as MobileMessageInput["accountId"],
  remoteChatId: "chat" as MobileMessageInput["remoteChatId"], whatsappMessageId: "protocol" as MobileMessageInput["whatsappMessageId"],
  direction: "incoming" as const, sentAt: new Date(0), content: { type: "text" as const, text: "original" } };
const message: MobileMessage = { ...input, ...context, id: messageId, chatId: randomUUID(), receivedAt, eventDispatchedAt: null };
const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unavailable" };

function dependencies(created = true, saved = message) {
  return {
    storeOnce: vi.fn<RegisterMobileMessageDependencies["storeOnce"]>(async () => ok({ created, message: saved })),
    dispatchMessageRecorded: vi.fn<RegisterMobileMessageDependencies["dispatchMessageRecorded"]>(async () => ok(undefined)),
    markEventDispatched: vi.fn<RegisterMobileMessageDependencies["markEventDispatched"]>(async () => ok(undefined)),
    newMessageId: () => randomUUID() as ChatMessageId,
    now: () => receivedAt,
  };
}

test("publishes only after the store returns its committed row and then marks it", async () => {
  let committed = false;
  const deps = dependencies();
  deps.storeOnce.mockImplementation(async () => { committed = true; return ok({ created: true, message }); });
  deps.dispatchMessageRecorded.mockImplementation(async () => { expect(committed).toBe(true); return ok(undefined); });
  expect(await registerMobileMessage(input, context, deps)).toEqual(ok({ status: "stored", messageId, eventId: messageId, receivedAt }));
  expect(deps.dispatchMessageRecorded).toHaveBeenCalledWith({ companyId, messageId }, { eventId: messageId, occurredAt: receivedAt.toISOString() });
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
  expect(pending.dispatchMessageRecorded).toHaveBeenCalledWith({ companyId, messageId }, { eventId: messageId, occurredAt: receivedAt.toISOString() });
});

test("dispatch and marker failures leave registration unsuccessful and allow identical retry", async () => {
  const deps = dependencies();
  deps.dispatchMessageRecorded.mockResolvedValueOnce(err({ code: "EVENT_BUS_UNAVAILABLE", message: "Unavailable" }));
  expect(await registerMobileMessage(input, context, deps)).toMatchObject({ success: false, error: { code: "EVENT_BUS_UNAVAILABLE" } });
  expect(deps.markEventDispatched).not.toHaveBeenCalled();
  deps.markEventDispatched.mockResolvedValueOnce(err(failure));
  expect(await registerMobileMessage(input, context, deps)).toEqual(err(failure));
  expect(await registerMobileMessage(input, context, deps)).toMatchObject({ success: true, data: { eventId: messageId } });
  expect(deps.dispatchMessageRecorded.mock.calls).toHaveLength(3);
  expect(deps.dispatchMessageRecorded.mock.calls.every(([payload, metadata]) => payload.messageId === messageId && metadata.eventId === messageId)).toBe(true);
});

test("rejects a stored row from another tenant and propagates unexpected exceptions", async () => {
  const deps = dependencies(true, { ...message, companyId: randomUUID() as RegistrationContext["companyId"] });
  expect(await registerMobileMessage(input, context, deps)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(deps.dispatchMessageRecorded).not.toHaveBeenCalled();
  deps.storeOnce.mockRejectedValue(new Error("unexpected"));
  await expect(registerMobileMessage(input, context, deps)).rejects.toThrow("unexpected");
});
