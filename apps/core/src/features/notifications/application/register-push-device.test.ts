import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { registerPushDevice } from "@core/src/features/notifications/application/register-push-device";
import { unregisterPushDevice } from "@core/src/features/notifications/application/unregister-push-device";

const access = { userId: "user-1", sessionId: "session-1" };
const input = { token: "ExponentPushToken[a]", platform: "android", locale: "es" } as const;

test("registers the device for the session and reports whether a token moved", async () => {
  const saved: unknown[] = [];
  const result = await registerPushDevice(input, access, { save: async (device) => { saved.push(device); return ok({ moved: true }); } });
  expect(result).toEqual(ok(null));
  expect(saved).toEqual([{ ...input, ...access }]);
});

test("rejects a token that is not an Expo push token", async () => {
  const result = await registerPushDevice({ ...input, token: "nope" as never }, access, { save: async () => ok({ moved: false }) });
  expect(result).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
});

test("passes persistence failures through", async () => {
  const result = await registerPushDevice(input, access, { save: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
  expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});

test("unregisters by token and ignores persistence failures", async () => {
  const removed: string[] = [];
  const deps = { removeByToken: async (token: string) => { removed.push(token); return ok(null); } };
  expect(await unregisterPushDevice({ token: "ExponentPushToken[a]" }, deps)).toEqual(ok(null));
  expect(removed).toEqual(["ExponentPushToken[a]"]);
  expect(await unregisterPushDevice({ token: "x" }, { removeByToken: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) }))
    .toMatchObject({ success: false });
});
