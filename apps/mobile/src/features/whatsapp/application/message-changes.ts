import type { MessageStore } from "@mobile/features/whatsapp/application/ports";

export type MessageChanges = Readonly<{
  notify(): void;
  subscribe(listener: () => void): () => void;
}>;

/** Tells the presentation that stored messages changed, so lists can reload without polling. */
export function createMessageChanges(): MessageChanges {
  const listeners = new Set<() => void>();
  return {
    notify() { for (const listener of [...listeners]) listener(); },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Notifies after the writes that change what a list shows: a new message and a sync outcome.
 * markRetry only reschedules, so it does not change the list or the unsynced counter.
 */
export function withChangeNotifications(store: MessageStore, changes: MessageChanges): MessageStore {
  return {
    ...store,
    async saveOnce(message, placement, now) {
      const result = await store.saveOnce(message, placement, now);
      if (result.success && result.data.status === "stored") changes.notify();
      return result;
    },
    async markSynced(id, coreMessageId, at) {
      const result = await store.markSynced(id, coreMessageId, at);
      if (result.success) changes.notify();
      return result;
    },
    async markRejected(id, code, at) {
      const result = await store.markRejected(id, code, at);
      if (result.success) changes.notify();
      return result;
    },
  };
}
