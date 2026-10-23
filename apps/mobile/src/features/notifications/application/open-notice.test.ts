import { err, ok } from "@shared/functional";
import type { NoticeDestination } from "../domain/notice-destination";
import { createNoticeInbox, openNotice, type OpenNoticePorts } from "./open-notice";

const company = "6f1d5c1e-5b0b-4c53-9a53-0d6a0b3b2a11";
const other = "0b1f2a43-9f3c-4f0e-8d0b-6f1a2b3c4d5e";
const messageId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const orderId = "9d3b1f7a-1c52-4c2e-bb0f-2f5d2f3b8a10";
const destination = (target: "message" | "order", companyId = company): NoticeDestination => ({ v: 1, companyId, messageId, target });

function setup(overrides: Partial<OpenNoticePorts> = {}) {
  const went: unknown[] = [];
  const ports: OpenNoticePorts = {
    findChatOfMessage: async () => ok("123@lid"),
    resolveOrder: async () => ok(orderId),
    confirmDiscard: async () => true,
    go: {
      chat: (chatId, noticeMessageId) => { went.push(["chat", chatId, noticeMessageId]); },
      chatsList: (reason) => { went.push(["chatsList", reason]); },
      order: (id) => { went.push(["order", id]); },
      home: () => { went.push(["home"]); },
    },
    ...overrides,
  };
  return { ports, went };
}

test("opens the chat of a message notice on the notice's message", async () => {
  const { ports, went } = setup();
  expect(await openNotice(destination("message"), ports)).toBe("opened");
  expect(went).toEqual([["chat", "123@lid", messageId]]);
});

test("opens the chats list with the chat missing reason when the phone has no such message", async () => {
  const { ports, went } = setup({ findChatOfMessage: async () => ok(null) });
  expect(await openNotice(destination("message"), ports)).toBe("chat_missing");
  expect(went).toEqual([["chatsList", "chat_missing"]]);
});

test("opens the order of an order notice resolved through core", async () => {
  const resolveOrder = jest.fn(async () => ok(orderId));
  const { ports, went } = setup({ resolveOrder });
  expect(await openNotice(destination("order"), ports)).toBe("opened");
  expect(resolveOrder).toHaveBeenCalledWith(messageId);
  expect(went).toEqual([["order", orderId]]);
});

test("goes nowhere and does not ask to discard when the destination cannot be resolved", async () => {
  const confirmDiscard = jest.fn(async () => true);
  const order = setup({ resolveOrder: async () => err({ code: "NETWORK_ERROR", message: "offline" }), confirmDiscard });
  expect(await openNotice(destination("order"), order.ports)).toBe("failed");
  const message = setup({ findChatOfMessage: async () => err({ code: "LOCAL_STORAGE_FAILED", message: "x" }), confirmDiscard });
  expect(await openNotice(destination("message"), message.ports)).toBe("failed");
  expect([...order.went, ...message.went, ...confirmDiscard.mock.calls]).toEqual([]);
});

test("asks to discard a dirty sale before opening and stays put when the seller keeps editing", async () => {
  const confirmDiscard = jest.fn(async () => false);
  const { ports, went } = setup({ confirmDiscard });
  expect(await openNotice(destination("message"), ports)).toBe("cancelled");
  expect(confirmDiscard).toHaveBeenCalledTimes(1);
  expect(went).toEqual([]);
  confirmDiscard.mockResolvedValue(true);
  expect(await openNotice(destination("message"), ports)).toBe("opened");
  expect(went).toEqual([["chat", "123@lid", messageId]]);
});

test("keeps a destination received while signed out until a session exists", () => {
  const inbox = createNoticeInbox();
  inbox.hold(destination("message"));
  expect(inbox.settle(null)).toBeNull();
  expect(inbox.settle(null)).toBeNull();
});

test("opens the held destination after signing in to the same company, once", () => {
  const inbox = createNoticeInbox();
  inbox.hold(destination("order"));
  expect(inbox.settle({ companyId: company })).toEqual({ kind: "open", destination: destination("order") });
  expect(inbox.settle({ companyId: company })).toBeNull();
});

test("goes home after signing in to another company and forgets the destination", () => {
  const inbox = createNoticeInbox();
  inbox.hold(destination("message"));
  expect(inbox.settle({ companyId: other })).toEqual({ kind: "home" });
  expect(inbox.settle({ companyId: other })).toBeNull();
});

test("a later destination replaces the held one", () => {
  const inbox = createNoticeInbox();
  inbox.hold(destination("message"));
  inbox.hold(destination("order"));
  expect(inbox.settle({ companyId: company })).toEqual({ kind: "open", destination: destination("order") });
});
