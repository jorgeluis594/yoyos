import { expect, test } from "vitest";
import { readNotificationsEnv } from "@core/src/features/notifications/infrastructure/notifications-env";

test("defaults to no provider and a ten minute time to live", () => {
  expect(readNotificationsEnv({})).toEqual({ PUSH_PROVIDER: "none", EXPO_ACCESS_TOKEN: undefined, PUSH_NOTICE_TTL_SECONDS: 600 });
  expect(readNotificationsEnv({ PUSH_PROVIDER: "expo", EXPO_ACCESS_TOKEN: "t", PUSH_NOTICE_TTL_SECONDS: "300" }))
    .toEqual({ PUSH_PROVIDER: "expo", EXPO_ACCESS_TOKEN: "t", PUSH_NOTICE_TTL_SECONDS: 300 });
});

test("rejects an unknown provider and an invalid time to live", () => {
  expect(() => readNotificationsEnv({ PUSH_PROVIDER: "fcm" })).toThrow();
  expect(() => readNotificationsEnv({ PUSH_NOTICE_TTL_SECONDS: "0" })).toThrow();
});
