import type { NoticeStore, StoredRegistration } from "../application/ports";

export type SecureValueStorage = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}>;

const registrationKey = "yoyos_notice_registration";
const pendingKey = "yoyos_notice_pending_unregister";
const promptedKey = "yoyos_notice_prompted";

/** Secure storage of the last registration, the pending unregister token and the once-per-installation prompt flag. */
export function createNoticeStore(storage: SecureValueStorage): NoticeStore {
  const read = async (key: string) => { try { return await storage.getItemAsync(key); } catch { return null; } };
  const write = async (key: string, value: string) => { try { await storage.setItemAsync(key, value); } catch { /* the next check registers again */ } };
  const remove = async (key: string) => { try { await storage.deleteItemAsync(key); } catch { /* nothing to clear */ } };
  return {
    readRegistration: async () => {
      const raw = await read(registrationKey);
      if (raw === null) return null;
      try {
        const value = JSON.parse(raw) as Partial<StoredRegistration>;
        return typeof value.fingerprint === "string" && typeof value.token === "string" ? { fingerprint: value.fingerprint, token: value.token } : null;
      } catch { return null; }
    },
    writeRegistration: (registration) => write(registrationKey, JSON.stringify(registration)),
    clearRegistration: () => remove(registrationKey),
    readPendingUnregister: () => read(pendingKey),
    writePendingUnregister: (token) => write(pendingKey, token),
    clearPendingUnregister: () => remove(pendingKey),
    wasPrompted: async () => (await read(promptedKey)) === "1",
    markPrompted: () => write(promptedKey, "1"),
  };
}
