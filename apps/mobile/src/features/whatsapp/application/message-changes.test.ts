import { err, ok } from "@shared/functional";
import { createMessageChanges, withChangeNotifications } from "@mobile/features/whatsapp/application/message-changes";
import type { MessageStore } from "@mobile/features/whatsapp/application/ports";

function setup(overrides: Partial<MessageStore> = {}) {
  const raw = {
    saveOnce: async () => ok({ status: "stored" as const, message: {} }),
    markSynced: async () => ok(undefined),
    markRetry: async () => ok(undefined),
    markRejected: async () => ok(undefined),
    nextRetryAt: async () => ok(null),
    ...overrides,
  } as unknown as MessageStore;
  const changes = createMessageChanges();
  const listener = jest.fn();
  changes.subscribe(listener);
  return { store: withChangeNotifications(raw, changes), listener, changes };
}

test("notifies after a stored message, a sync and a rejection", async () => {
  const { store, listener } = setup();
  await store.saveOnce({} as never, {} as never, new Date());
  await store.markSynced("m" as never, "c" as never, new Date());
  await store.markRejected("m" as never, "X" as never, new Date());
  expect(listener).toHaveBeenCalledTimes(3);
});

test("does not notify for duplicates, retries or failed writes", async () => {
  const { store, listener } = setup({
    saveOnce: async () => ok({ status: "duplicate" as const, message: {} as never }),
    markSynced: async () => err({ code: "LOCAL_STORAGE_FAILED" as const, message: "x" }),
  });
  await store.saveOnce({} as never, {} as never, new Date());
  await store.markRetry("m" as never, 1, new Date());
  await store.markSynced("m" as never, "c" as never, new Date());
  expect(listener).not.toHaveBeenCalled();
});

test("passes through other store methods and stops notifying after unsubscribe", async () => {
  const { store, changes } = setup();
  expect(await store.nextRetryAt("c" as never)).toEqual(ok(null));
  const late = jest.fn();
  changes.subscribe(late)();
  changes.notify();
  expect(late).not.toHaveBeenCalled();
});
