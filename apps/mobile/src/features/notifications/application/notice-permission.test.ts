import { createFakeGateway, createFakeStore } from "./fakes";
import { enableNotices, promptForNotices } from "./notice-permission";

test("asks for notification permission once when the WhatsApp link first becomes connected", async () => {
  const { gateway, state } = createFakeGateway("undetermined");
  const { store } = createFakeStore();
  const confirm = jest.fn(async () => true);

  expect(await promptForNotices({ gateway, store, confirm })).toBe("granted");
  expect(await promptForNotices({ gateway, store, confirm })).toBe("granted");

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(state.requests).toBe(1);
});

test("does not ask again after «Ahora no» and leaves the permission off", async () => {
  const { gateway, state } = createFakeGateway("undetermined");
  const { store } = createFakeStore();
  const confirm = jest.fn(async () => false);

  expect(await promptForNotices({ gateway, store, confirm })).toBe("undetermined");
  expect(await promptForNotices({ gateway, store, confirm })).toBe("undetermined");

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(state.requests).toBe(0);
});

test("does not ask when the permission was already decided", async () => {
  const { gateway } = createFakeGateway("denied");
  const confirm = jest.fn(async () => true);
  expect(await promptForNotices({ gateway, store: createFakeStore().store, confirm })).toBe("denied");
  expect(confirm).not.toHaveBeenCalled();
});

test("the banner button shows the system dialog when it was never shown and opens settings after a denial", async () => {
  const never = createFakeGateway("undetermined");
  expect(await enableNotices({ gateway: never.gateway, store: createFakeStore().store })).toBe("granted");
  expect(never.state.requests).toBe(1);
  expect(never.state.settingsOpened).toBe(0);

  const denied = createFakeGateway("denied");
  expect(await enableNotices({ gateway: denied.gateway, store: createFakeStore().store })).toBe("denied");
  expect(denied.state.settingsOpened).toBe(1);
  expect(denied.state.requests).toBe(0);
});
