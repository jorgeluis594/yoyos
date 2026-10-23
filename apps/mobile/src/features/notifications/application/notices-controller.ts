import type { NoticeSession } from "../domain/notice-destination";
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
  onTokenChange: (listener: () => void) => () => void;
  decideForeground: (data: unknown) => Promise<ForegroundDecision>;
}>;

export function createNoticesController(dependencies: NoticesDependencies): NoticesController {
  const { gateway, store, api, platform } = dependencies;
  let session: NoticeSession = null;
  return {
    session: () => session,
    setSession: (next) => { session = next; },
    permission: () => gateway.permission(),
    promptOnConnected: () => promptForNotices({ gateway, store, confirm: dependencies.confirm }),
    enable: () => enableNotices({ gateway, store }),
    sync: async () => {
      await flushPendingUnregister({ store, api });
      const sessionId = await dependencies.readSessionId();
      if (sessionId === null) return "skipped";
      return registerPushDevice({ sessionId, locale: dependencies.locale() }, { gateway, store, api, platform });
    },
    onTokenChange: gateway.onTokenChange,
    decideForeground: (data) => decideForegroundNotice(data, session, store),
  };
}
