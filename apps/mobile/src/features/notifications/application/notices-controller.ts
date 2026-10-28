import { parseNoticeDestination, shouldShowNotice, type NoticeDestination, type NoticeSession } from "../domain/notice-destination";
import { decideForegroundNotice, type ForegroundDecision } from "./foreground-filter";
import { enableNotices, promptForNotices } from "./notice-permission";
import type { NoticeGateway, NoticeLocale, NoticePermission, NoticeStore, PushDeviceApi } from "./ports";
import { flushPendingUnregister, registerPushDevice, type RegistrationOutcome } from "./register-push-device";

export type NoticesDependencies = Readonly<{
  gateway: NoticeGateway;
  store: NoticeStore;
  api: PushDeviceApi;
  platform: "ios" | "android";
  /** The Better Auth session of the phone, or `null` when it cannot be read. */
  readSessionId: () => Promise<string | null>;
  locale: () => NoticeLocale;
  confirm: () => Promise<boolean>;
}>;

export type NoticesController = Readonly<{
  session: () => NoticeSession;
  setSession: (session: NoticeSession) => void;
  permission: () => Promise<NoticePermission>;
  /** Called when the WhatsApp link becomes connected. */
  promptOnConnected: () => Promise<NoticePermission>;
  enable: () => Promise<NoticePermission>;
  /** Sign-in, foreground and token change: sends the pending unregister, then registers if the fingerprint changed. */
  sync: () => Promise<RegistrationOutcome>;
  /** Sends the pending unregister alone; it needs no session, so it also runs while signed out. */
  flushPending: () => Promise<boolean>;
  onTokenChange: (listener: () => void) => () => void;
  /** Calls back with each notice the seller taps, the one that launched the app included; never twice for the same tap. */
  watchResponses: (listener: (destination: NoticeDestination) => void) => () => void;
  /** Calls back with each notice of the signed-in company that reaches the running app. */
  watchArrivals: (listener: (destination: NoticeDestination) => void) => () => void;
  decideForeground: (data: unknown) => Promise<ForegroundDecision>;
}>;

export function createNoticesController(dependencies: NoticesDependencies): NoticesController {
  const { gateway, store, api, platform } = dependencies;
  let session: NoticeSession = null;
  const handled = new Set<string>();
  return {
    session: () => session,
    setSession: (next) => { session = next; },
    permission: () => gateway.permission(),
    promptOnConnected: () => promptForNotices({ gateway, store, confirm: dependencies.confirm }),
    enable: () => enableNotices({ gateway, store }),
    flushPending: () => flushPendingUnregister({ store, api }),
    sync: async () => {
      await flushPendingUnregister({ store, api });
      const sessionId = await dependencies.readSessionId();
      if (sessionId === null) return "skipped";
      return registerPushDevice({ sessionId, locale: dependencies.locale() }, { gateway, store, api, platform });
    },
    onTokenChange: gateway.onTokenChange,
    watchResponses: (listener) => {
      let active = true;
      const handle = (response: { id: string; data: unknown }) => {
        if (!active || handled.has(response.id)) return;
        const destination = parseNoticeDestination(response.data);
        if (destination === null) return;
        handled.add(response.id);
        listener(destination);
      };
      const unsubscribe = gateway.onResponse(handle);
      void gateway.lastResponse().then((response) => { if (response !== null) handle(response); }).catch(() => undefined);
      return () => { active = false; unsubscribe(); };
    },
    watchArrivals: (listener) => gateway.onReceived((data) => {
      const destination = parseNoticeDestination(data);
      if (destination !== null && shouldShowNotice(data, session)) listener(destination);
    }),
    decideForeground: (data) => decideForegroundNotice(data, session, store),
  };
}
