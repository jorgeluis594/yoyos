import { createFakeApi, createFakeGateway, createFakeStore } from "./fakes";
import { createNoticesController } from "./notices-controller";

function setup(sessionId: string | null = "session-1") {
  const gateway = createFakeGateway();
  const store = createFakeStore();
  const api = createFakeApi();
  const controller = createNoticesController({
    gateway: gateway.gateway, store: store.store, api: api.api, platform: "android",
    readSessionId: async () => sessionId, locale: () => "es", confirm: async () => true,
  });
  return { controller, gateway, store, api };
}

test("syncs by sending the pending unregister first and registering once per fingerprint", async () => {
  const { controller, store, api } = setup();
  store.state.pending = "ExponentPushToken[old]";

  expect(await controller.sync()).toBe("registered");
  expect(await controller.sync()).toBe("unchanged");

  expect(api.state.unregistered).toEqual(["ExponentPushToken[old]"]);
  expect(api.state.registered).toHaveLength(1);
});

test("does not register while the session cannot be read", async () => {
  const { controller, api } = setup(null);
  expect(await controller.sync()).toBe("skipped");
  expect(api.state.registered).toEqual([]);
});

test("hides foreground notices of other companies using the session it was given", async () => {
  const { controller } = setup();
  const data = { v: 1, companyId: "6f1d5c1e-5b0b-4c53-9a53-0d6a0b3b2a11", messageId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", target: "order" };
  expect(await controller.decideForeground(data)).toBe("hide");
  controller.setSession({ companyId: data.companyId });
  expect(await controller.decideForeground(data)).toBe("show");
});

const foreign = { v: 1, companyId: "6f1d5c1e-5b0b-4c53-9a53-0d6a0b3b2a11", messageId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", target: "order" };

test("registers the phone again after a cold-start foreground notice queued its own valid token", async () => {
  const { controller, store, api } = setup();
  await controller.sync();
  controller.setSession(null);
  expect(await controller.decideForeground(foreign)).toBe("hide");
  controller.setSession({ companyId: "company-1" });

  expect(await controller.sync()).toBe("registered");

  expect(api.state.unregistered).toEqual(["ExponentPushToken[abc]"]);
  expect(api.state.registered).toHaveLength(2);
  expect(store.state.registration?.token).toBe("ExponentPushToken[abc]");
});

test("registers the phone again after a stray notice of another company", async () => {
  const { controller, api } = setup();
  controller.setSession({ companyId: "company-1" });
  await controller.sync();
  expect(await controller.decideForeground(foreign)).toBe("hide");

  expect(await controller.sync()).toBe("registered");
  expect(api.state.unregistered).toEqual(["ExponentPushToken[abc]"]);
  expect(api.state.registered).toHaveLength(2);
});

test("keeps the registration and retries the unregister while core fails, then registers again", async () => {
  const { controller, store, api } = setup();
  await controller.sync();
  store.state.pending = "ExponentPushToken[abc]";
  api.state.failure = { code: "NETWORK_ERROR", message: "offline" };

  expect(await controller.sync()).toBe("unchanged");
  expect(store.state.pending).toBe("ExponentPushToken[abc]");
  expect(store.state.registration).not.toBeNull();

  api.state.failure = null;
  expect(await controller.sync()).toBe("registered");
  expect(store.state.pending).toBeNull();
});

test("sends the pending unregister alone, without a session", async () => {
  const { controller, store, api } = setup(null);
  store.state.pending = "ExponentPushToken[old]";

  expect(await controller.flushPending()).toBe(true);

  expect(api.state.unregistered).toEqual(["ExponentPushToken[old]"]);
  expect(api.state.registered).toEqual([]);
  expect(store.state.pending).toBeNull();
});
