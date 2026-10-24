import { createNoticeStore, type SecureValueStorage } from "./push-registration-store";

function memoryStorage(): SecureValueStorage {
  const values = new Map<string, string>();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}

test("keeps the registration, the pending unregister and the prompt flag apart", async () => {
  const store = createNoticeStore(memoryStorage());
  expect(await store.readRegistration()).toBeNull();
  expect(await store.wasPrompted()).toBe(false);

  await store.writeRegistration({ fingerprint: "f", token: "t" });
  await store.writePendingUnregister("old");
  await store.markPrompted();
  expect(await store.readRegistration()).toEqual({ fingerprint: "f", token: "t" });
  expect(await store.readPendingUnregister()).toBe("old");
  expect(await store.wasPrompted()).toBe(true);

  await store.clearRegistration();
  await store.clearPendingUnregister();
  expect(await store.readRegistration()).toBeNull();
  expect(await store.readPendingUnregister()).toBeNull();
  expect(await store.wasPrompted()).toBe(true);
});

test("treats corrupted or unreadable storage as empty", async () => {
  const storage = memoryStorage();
  await storage.setItemAsync("yoyos_notice_registration", "{not json");
  expect(await createNoticeStore(storage).readRegistration()).toBeNull();

  const broken: SecureValueStorage = { getItemAsync: async () => { throw new Error("locked"); }, setItemAsync: async () => { throw new Error("locked"); }, deleteItemAsync: async () => { throw new Error("locked"); } };
  const store = createNoticeStore(broken);
  expect(await store.readPendingUnregister()).toBeNull();
  await expect(store.writeRegistration({ fingerprint: "f", token: "t" })).resolves.toBeUndefined();
});
