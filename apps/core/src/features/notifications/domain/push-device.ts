import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type ExpoPushToken = string & { readonly __brand: "ExpoPushToken" };
export type PushDeviceId = string & { readonly __brand: "PushDeviceId" };
export type PushPlatform = "ios" | "android";
export type NoticeLocale = "es" | "pt-BR";

export type PushDevice = Readonly<{
  id: PushDeviceId;
  sessionId: string;
  userId: string;
  token: ExpoPushToken;
  platform: PushPlatform;
  locale: NoticeLocale;
}>;

const expoPushTokenPattern = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export function parseExpoPushToken(value: string): Result<ExpoPushToken, Readonly<{ code: "INVALID_PUSH_TOKEN"; message: string }>> {
  return expoPushTokenPattern.test(value) ? ok(value as ExpoPushToken) : err({ code: "INVALID_PUSH_TOKEN", message: "Invalid Expo push token" });
}
