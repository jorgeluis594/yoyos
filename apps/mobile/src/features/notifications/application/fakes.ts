import { err, ok } from "@shared/functional";
import type { NoticeError, NoticeGateway, NoticePermission, NoticeStore, PushDeviceApi, StoredRegistration } from "./ports";

export function createFakeGateway(initial: NoticePermission = "granted", token = "ExponentPushToken[abc]") {
  const state = { permission: initial, token, dismissed: 0, settingsOpened: 0, requests: 0, grantOnRequest: true };
  const gateway: NoticeGateway = {
    permission: async () => state.permission,
    requestPermission: async () => {
      state.requests++;
      state.permission = state.grantOnRequest ? "granted" : "denied";
      return state.permission;
    },
    openSettings: async () => { state.settingsOpened++; },
    getToken: async () => ok(state.token),
    dismissAll: async () => { state.dismissed++; },
  };
  return { gateway, state };
}

export function createFakeStore(initial: Partial<{ registration: StoredRegistration; pending: string; prompted: boolean }> = {}) {
  const state = { registration: initial.registration ?? null as StoredRegistration | null, pending: initial.pending ?? null as string | null, prompted: initial.prompted ?? false };
  const store: NoticeStore = {
    readRegistration: async () => state.registration,
    writeRegistration: async (registration) => { state.registration = registration; },
    clearRegistration: async () => { state.registration = null; },
    readPendingUnregister: async () => state.pending,
    writePendingUnregister: async (token) => { state.pending = token; },
    clearPendingUnregister: async () => { state.pending = null; },
    wasPrompted: async () => state.prompted,
    markPrompted: async () => { state.prompted = true; },
  };
  return { store, state };
}

export function createFakeApi(failure: NoticeError | null = null) {
  const state = { registered: [] as unknown[], unregistered: [] as string[], failure };
  const api: PushDeviceApi = {
    register: async (request) => {
      if (state.failure) return err(state.failure);
      state.registered.push(request);
      return ok(null);
    },
    unregister: async (token) => {
      if (state.failure) return err(state.failure);
      state.unregistered.push(token);
      return ok(null);
    },
  };
  return { api, state };
}
