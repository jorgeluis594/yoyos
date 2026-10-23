import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { PushDevice } from "@core/src/features/notifications/domain/push-device";
import type { PushSendError, RenderedNotice } from "@core/src/features/notifications/application/send-chat-message-notice";

export const noticeChannelId = "chat-notices";

/** The part of the Expo SDK the sender uses, so tests can fake it. */
export type ExpoGateway = Readonly<{ send: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]> }>;

export function createExpoGateway(accessToken: string | undefined): ExpoGateway {
  const expo = new Expo({ accessToken });
  return { send: (messages) => expo.sendPushNotificationsAsync(messages) };
}

export function buildExpoMessage(device: PushDevice, notice: RenderedNotice, ttlSeconds: number): ExpoPushMessage {
  return {
    to: device.token,
    title: notice.title,
    body: notice.body,
    data: { ...notice.data },
    sound: "default",
    priority: "high",
    ttl: ttlSeconds,
    channelId: noticeChannelId,
    // Expo forwards threadId to APNs, which groups the chat's notices. It has no Android grouping field: Android groups by app.
    threadId: notice.groupKey,
  };
}

const retryableTicketErrors = new Set(["MessageRateExceeded", "ProviderError", "ExpoError"]);

export function classifyTicket(ticket: ExpoPushTicket | undefined): Result<null, PushSendError> {
  if (!ticket) return err({ code: "PROVIDER_UNAVAILABLE", message: "Expo returned no ticket", retryable: true });
  if (ticket.status === "ok") return ok(null);
  const code = ticket.details?.error;
  if (code === "DeviceNotRegistered") return err({ code: "DEVICE_NOT_REGISTERED", message: "Device not registered", retryable: false });
  if (code && retryableTicketErrors.has(code)) return err({ code: "PROVIDER_UNAVAILABLE", message: "Expo could not deliver now", retryable: true });
  return err({ code: "PROVIDER_REJECTED", message: "Expo rejected the notice", retryable: false });
}

/** A request failure is retryable unless Expo answered with a client error other than rate limiting (bad credentials, bad request). */
export function classifyRequestFailure(cause: unknown): PushSendError {
  const statusCode = typeof cause === "object" && cause !== null && "statusCode" in cause && typeof cause.statusCode === "number" ? cause.statusCode : null;
  const retryable = statusCode === null || statusCode >= 500 || statusCode === 429;
  return retryable
    ? { code: "PROVIDER_UNAVAILABLE", message: "Expo is unavailable", retryable: true }
    : { code: "PROVIDER_REJECTED", message: "Expo rejected the request", retryable: false };
}

function abortion(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export function createExpoPushSender(gateway: ExpoGateway, options: Readonly<{ ttlSeconds: number }>) {
  return async (device: PushDevice, notice: RenderedNotice, signal: AbortSignal): Promise<Result<null, PushSendError>> => {
    const startedAt = Date.now();
    const finish = (failure: PushSendError, statusCode?: number) => {
      log.warn({ event: "notifications_push_provider_failed", errorCode: failure.code, statusCode: statusCode ?? null, attempt: 1, durationMs: Date.now() - startedAt }, "Push provider failed");
      return err(failure);
    };
    try {
      const [ticket] = await Promise.race([gateway.send([buildExpoMessage(device, notice, options.ttlSeconds)]), abortion(signal)]);
      const classified = classifyTicket(ticket);
      return classified.success ? classified : finish(classified.error);
    } catch (cause) {
      const statusCode = typeof cause === "object" && cause !== null && "statusCode" in cause && typeof cause.statusCode === "number" ? cause.statusCode : undefined;
      return finish(classifyRequestFailure(cause), statusCode);
    }
  };
}

/** Used when `PUSH_PROVIDER=none`: the notice is dropped without a retry. */
export const disabledPushSender = async (): Promise<Result<null, PushSendError>> =>
  err({ code: "PROVIDER_REJECTED", message: "Push provider disabled", retryable: false });
