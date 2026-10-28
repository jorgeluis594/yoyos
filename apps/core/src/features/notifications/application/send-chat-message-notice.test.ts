import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { PushDevice } from "@core/src/features/notifications/domain/push-device";
import {
  sendChatMessageNotice, type NoticeClaim, type RenderedNotice, type SendChatMessageNoticeDependencies,
} from "@core/src/features/notifications/application/send-chat-message-notice";

const input = { companyId: "company-1", messageId: "message-1" };
const claim: NoticeClaim = { messageId: "message-1", chatId: "chat-1", sessionId: "session-1", notice: { kind: "order_ready" } };
const device = { id: "device-1", sessionId: "session-1", token: "ExponentPushToken[a]", platform: "ios", locale: "pt-BR" } as unknown as PushDevice;
const rendered: RenderedNotice = { title: "T", body: "B", data: { v: 1 }, groupKey: "chat-1" };

function setup(overrides: Partial<SendChatMessageNoticeDependencies> = {}) {
  const calls: string[] = [];
  const sent: { device: PushDevice; notice: RenderedNotice }[] = [];
  const locales: string[] = [];
  const lookups: unknown[][] = [];
  const deps: SendChatMessageNoticeDependencies = {
    claimNotice: async () => { calls.push("claim"); return ok(claim); },
    describeNotice: async (_claim, locale) => { calls.push("describe"); locales.push(locale); return ok(rendered); },
    releaseNotice: async () => { calls.push("release"); return ok(null); },
    findDeviceForSession: async (...args) => { calls.push("find"); lookups.push(args); return ok(device); },
    sendPush: async (target, notice) => { calls.push("send"); sent.push({ device: target, notice }); return ok(null); },
    removeDevice: async () => { calls.push("remove"); return ok(null); },
    ...overrides,
  };
  return { deps, calls, sent, locales, lookups };
}
const run = (deps: SendChatMessageNoticeDependencies) => sendChatMessageNotice(input, { attempt: 1 }, deps);

test("sends the rendered notice in the device locale to the session that registered the message", async () => {
  const { deps, sent, locales, lookups, calls } = setup();
  expect(await run(deps)).toEqual(ok({ status: "sent" }));
  expect(lookups).toEqual([["session-1", "company-1"]]);
  expect(locales).toEqual(["pt-BR"]);
  expect(sent).toEqual([{ device, notice: rendered }]);
  expect(calls).toEqual(["claim", "find", "describe", "send"]);
});

test("drops the notice when the session has no device, expired or belongs to another company", async () => {
  const { deps, calls } = setup({ findDeviceForSession: async () => ok(null) });
  expect(await run(deps)).toEqual(ok({ status: "dropped", reason: "no_device" }));
  expect(calls).toEqual(["claim"]);
});

test("releases the claim and retries when the provider is unavailable", async () => {
  const { deps, calls } = setup({ sendPush: async () => err({ code: "PROVIDER_UNAVAILABLE", message: "down", retryable: true }) });
  expect(await run(deps)).toMatchObject({ success: false, error: { code: "PROVIDER_UNAVAILABLE", retryable: true } });
  expect(calls).toEqual(["claim", "find", "describe", "release"]);
});

test("removes the device when the provider reports it is not registered", async () => {
  const removed: string[] = [];
  const { deps } = setup({
    sendPush: async () => err({ code: "DEVICE_NOT_REGISTERED", message: "gone", retryable: false }),
    removeDevice: async (id) => { removed.push(id); return ok(null); },
  });
  expect(await run(deps)).toEqual(ok({ status: "dropped", reason: "device_not_registered" }));
  expect(removed).toEqual(["device-1"]);
});

test("does nothing when the notice was already claimed", async () => {
  const { deps, calls } = setup({ claimNotice: async () => ok(null) });
  expect(await run(deps)).toEqual(ok({ status: "dropped", reason: "already_sent" }));
  expect(calls).toEqual([]);
});

test("groups the notice by the message's chat", async () => {
  const { deps, sent } = setup();
  await run(deps);
  expect(sent[0]?.notice.groupKey).toBe(claim.chatId);
});

test("completes without retrying on a permanent provider failure", async () => {
  const { deps, calls } = setup({ sendPush: async () => err({ code: "PROVIDER_REJECTED", message: "bad", retryable: false }) });
  expect(await run(deps)).toEqual(ok({ status: "dropped", reason: "provider_rejected" }));
  expect(calls).not.toContain("release");
});

test("fails retryably when the claim cannot be read", async () => {
  const { deps } = setup({ claimNotice: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down", retryable: true }) });
  expect(await run(deps)).toMatchObject({ success: false, error: { retryable: true } });
});

test("keeps the claim and does not retry when the provider does not answer in time", async () => {
  const { deps, calls } = setup({ sendPush: async () => err({ code: "SEND_TIMEOUT", message: "slow", retryable: false }) });
  expect(await run(deps)).toEqual(ok({ status: "dropped", reason: "timeout" }));
  expect(calls).not.toContain("release");
});

test("fails retryably with the release error when giving the claim back fails", async () => {
  const { deps, calls } = setup({
    sendPush: async () => err({ code: "PROVIDER_UNAVAILABLE", message: "down", retryable: true }),
    releaseNotice: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "db down" }),
  });
  expect(await run(deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", retryable: true } });
  expect(calls).toEqual(["claim", "find", "describe"]);
});

test("fails retryably and keeps the device when removing it fails", async () => {
  const { deps } = setup({
    sendPush: async () => err({ code: "DEVICE_NOT_REGISTERED", message: "gone", retryable: false }),
    removeDevice: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "db down" }),
  });
  expect(await run(deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", retryable: true } });
});
