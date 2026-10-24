import { createFakeGateway, createFakeStore } from "./fakes";
import { cleanNoticesOnSignOut } from "./sign-out-notices";

const registration = { fingerprint: "f", token: "ExponentPushToken[abc]" };

test("dismisses notices and queues an unregister when sign-out cannot reach core", async () => {
  const { gateway, state: gatewayState } = createFakeGateway();
  const { store, state } = createFakeStore({ registration });

  await cleanNoticesOnSignOut("unconfirmed", { gateway, store });

  expect(gatewayState.dismissed).toBe(1);
  expect(state.registration).toBeNull();
  expect(state.pending).toBe("ExponentPushToken[abc]");
});

test("dismisses notices and clears the fingerprint without a pending unregister when core deleted the session", async () => {
  const { gateway, state: gatewayState } = createFakeGateway();
  const { store, state } = createFakeStore({ registration });

  await cleanNoticesOnSignOut("confirmed", { gateway, store });

  expect(gatewayState.dismissed).toBe(1);
  expect(state.registration).toBeNull();
  expect(state.pending).toBeNull();
});
