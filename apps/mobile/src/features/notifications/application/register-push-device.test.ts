import { createFakeApi, createFakeGateway, createFakeStore } from "./fakes";
import { flushPendingUnregister, registerPushDevice } from "./register-push-device";

const session = { sessionId: "session-1", locale: "es" } as const;

test("registers the push device after sign-in and not again on foreground with the same fingerprint", async () => {
  const { gateway } = createFakeGateway();
  const { store } = createFakeStore();
  const { api, state } = createFakeApi();
  const dependencies = { gateway, store, api, platform: "android" } as const;

  expect(await registerPushDevice(session, dependencies)).toBe("registered");
  expect(await registerPushDevice(session, dependencies)).toBe("unchanged");

  expect(state.registered).toEqual([{ version: 1, token: "ExponentPushToken[abc]", platform: "android", locale: "es" }]);
});

test("registers again when the token, the locale or the session changes", async () => {
  const fake = createFakeGateway();
  const { store } = createFakeStore();
  const { api, state } = createFakeApi();
  const dependencies = { gateway: fake.gateway, store, api, platform: "ios" } as const;

  await registerPushDevice(session, dependencies);
  await registerPushDevice({ ...session, locale: "pt-BR" }, dependencies);
  await registerPushDevice({ sessionId: "session-2", locale: "pt-BR" }, dependencies);
  fake.state.token = "ExponentPushToken[new]";
  await registerPushDevice({ sessionId: "session-2", locale: "pt-BR" }, dependencies);

  expect(state.registered).toHaveLength(4);
});

test("sends nothing without permission and retries after a failed registration", async () => {
  const fake = createFakeGateway("denied");
  const { store, state: stored } = createFakeStore();
  const { api, state } = createFakeApi({ code: "NETWORK_ERROR", message: "offline" });
  const dependencies = { gateway: fake.gateway, store, api, platform: "android" } as const;

  expect(await registerPushDevice(session, dependencies)).toBe("skipped");
  fake.state.permission = "granted";
  expect(await registerPushDevice(session, dependencies)).toBe("failed");
  expect(stored.registration).toBeNull();

  state.failure = null;
  expect(await registerPushDevice(session, dependencies)).toBe("registered");
});

test("keeps a pending unregister until core answers", async () => {
  const { store, state: stored } = createFakeStore({ pending: "ExponentPushToken[old]" });
  const { api, state } = createFakeApi({ code: "NETWORK_ERROR", message: "offline" });

  expect(await flushPendingUnregister({ store, api })).toBe(false);
  expect(stored.pending).toBe("ExponentPushToken[old]");

  state.failure = null;
  expect(await flushPendingUnregister({ store, api })).toBe(true);
  expect(state.unregistered).toEqual(["ExponentPushToken[old]"]);
  expect(stored.pending).toBeNull();
  expect(await flushPendingUnregister({ store, api })).toBe(false);
});

test("clears the stored registration when the unregistered token is the phone's own", async () => {
  const { store, state: stored } = createFakeStore({ registration: { fingerprint: "f", token: "ExponentPushToken[abc]" }, pending: "ExponentPushToken[abc]" });
  const { api } = createFakeApi();

  expect(await flushPendingUnregister({ store, api })).toBe(true);
  expect(stored.registration).toBeNull();
});

test("keeps the stored registration when the unregistered token is another one", async () => {
  const registration = { fingerprint: "f", token: "ExponentPushToken[abc]" };
  const { store, state: stored } = createFakeStore({ registration, pending: "ExponentPushToken[old]" });
  const { api } = createFakeApi();

  await flushPendingUnregister({ store, api });
  expect(stored.registration).toEqual(registration);
});
