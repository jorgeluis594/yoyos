import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { parseExpoPushToken, type ExpoPushToken, type NoticeLocale, type PushPlatform } from "@core/src/features/notifications/domain/push-device";

export type RegisterPushDeviceInput = Readonly<{ token: string; platform: PushPlatform; locale: NoticeLocale }>;
export type PushDeviceAccess = Readonly<{ userId: string; sessionId: string }>;
export type RegisterPushDeviceError = Readonly<{ code: "INVALID_INPUT" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type RegisterPushDeviceDependencies = Readonly<{
  /** Deletes the rows with the same token and another session, then upserts by session. `moved` tells whether a token changed session. */
  save: (device: Readonly<{ token: ExpoPushToken; platform: PushPlatform; locale: NoticeLocale }> & PushDeviceAccess) =>
    Promise<Result<Readonly<{ moved: boolean }>, RegisterPushDeviceError>>;
  onRegistered?: (event: Readonly<{ userId: string; platform: PushPlatform; locale: NoticeLocale; moved: boolean }>) => void;
}>;

export async function registerPushDevice(
  input: RegisterPushDeviceInput,
  access: PushDeviceAccess,
  deps: RegisterPushDeviceDependencies,
): Promise<Result<null, RegisterPushDeviceError>> {
  const token = parseExpoPushToken(input.token);
  if (!token.success) return err({ code: "INVALID_INPUT", message: token.error.message });
  const saved = await deps.save({ token: token.data, platform: input.platform, locale: input.locale, ...access });
  if (!saved.success) return saved;
  deps.onRegistered?.({ userId: access.userId, platform: input.platform, locale: input.locale, moved: saved.data.moved });
  return ok(null);
}
