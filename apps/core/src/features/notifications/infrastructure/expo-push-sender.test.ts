import { expect, test } from "vitest";
import type { PushDevice } from "@core/src/features/notifications/domain/push-device";
import { createExpoPushSender, buildExpoMessage, type ExpoGateway } from "@core/src/features/notifications/infrastructure/expo-push-sender";

const device = { id: "d", sessionId: "s", userId: "u", token: "ExponentPushToken[a]", platform: "ios", locale: "es" } as unknown as PushDevice;
const notice = { title: "Pedido listo", body: "Pedido #12", data: { v: 1, target: "order" }, groupKey: "chat-1" };
const send = (gateway: ExpoGateway, signal = AbortSignal.timeout(1000)) => createExpoPushSender(gateway, { ttlSeconds: 600 })(device, notice, signal);

test("builds a high priority alert with ttl, channel and the chat as thread", () => {
  expect(buildExpoMessage(device, notice, 600)).toMatchObject({
    to: "ExponentPushToken[a]", title: "Pedido listo", body: "Pedido #12", data: { v: 1, target: "order" },
    ttl: 600, channelId: "chat-notices", threadId: "chat-1", priority: "high",
  });
});

test("succeeds on an ok ticket", async () => {
  expect(await send({ send: async () => [{ status: "ok", id: "1" }] })).toMatchObject({ success: true });
});

test("reports DeviceNotRegistered so the device is removed", async () => {
  const gateway: ExpoGateway = { send: async () => [{ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }] };
  expect(await send(gateway)).toMatchObject({ success: false, error: { code: "DEVICE_NOT_REGISTERED", retryable: false } });
});

test("treats 5xx, rate limits, timeouts and network errors as retryable", async () => {
  for (const cause of [Object.assign(new Error("x"), { statusCode: 503 }), Object.assign(new Error("x"), { statusCode: 429 }), new Error("network")])
    expect(await send({ send: async () => { throw cause; } })).toMatchObject({ success: false, error: { retryable: true } });
  const slow: ExpoGateway = { send: () => new Promise(() => undefined) };
  expect(await send(slow, AbortSignal.timeout(20))).toMatchObject({ success: false, error: { code: "PROVIDER_UNAVAILABLE", retryable: true } });
});

test("treats other client errors and rejected tickets as permanent", async () => {
  expect(await send({ send: async () => { throw Object.assign(new Error("x"), { statusCode: 400 }); } })).toMatchObject({ success: false, error: { retryable: false } });
  expect(await send({ send: async () => [{ status: "error", message: "big", details: { error: "MessageTooBig" } }] })).toMatchObject({ success: false, error: { code: "PROVIDER_REJECTED", retryable: false } });
  expect(await send({ send: async () => [{ status: "error", message: "busy", details: { error: "MessageRateExceeded" } }] })).toMatchObject({ success: false, error: { retryable: true } });
});
