import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ConnectionState, WhatsAppError, WhatsAppErrorCode, WhatsAppEvents } from "@mobile/modules/whatsapp/types";
import type { GatewayConfigurationError, LinkStore, Session, StoreError, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import type { ReceiveError, ReceiveOutcome } from "@mobile/features/whatsapp/application/receive-message";

export type ReceptionHandle = Readonly<{ stop(): void }>;
export type StartError =
  | Readonly<{ code: "NO_SESSION" | "NO_ACTIVE_LINK" | "LINK_OF_OTHER_COMPANY"; message: string }>
  | WhatsAppError | GatewayConfigurationError | StoreError;

/** Errors the library reports without cutting the connection; shown as a non-blocking notice. */
export const informationalErrorCodes: readonly WhatsAppErrorCode[] = ["RECOVERY_BUFFER_FULL", "HISTORY_LIMIT_REACHED", "IDENTITY_UNAVAILABLE"];

export type ReceptionStatus = Readonly<{
  connection: ConnectionState;
  qr: Readonly<{ value: string; expiresAt: number }> | null;
  notice: WhatsAppErrorCode | null;
  lastError: Readonly<{ code: string; message: string }> | null;
}>;

export type ReceptionDeps = Readonly<{
  whatsapp: Pick<WhatsAppGateway, "initialize" | "connect" | "disconnect" | "addListener">;
  links: LinkStore;
  session: () => Session | null;
  receive: (event: WhatsAppEvents["messageReceived"]) => Promise<Result<ReceiveOutcome, ReceiveError>>;
  sync: Readonly<{ wake(): void; stop(): void }>;
}>;

export function createReceptionLifecycle(deps: ReceptionDeps) {
  let subscriptions: readonly { remove(): void }[] = [];
  let status: ReceptionStatus = { connection: "disconnected", qr: null, notice: null, lastError: null };
  const listeners = new Set<(status: ReceptionStatus) => void>();

  const publish = (next: Partial<ReceptionStatus>) => {
    status = { ...status, ...next };
    listeners.forEach((listener) => listener(status));
  };

  const stop = () => {
    subscriptions.forEach((subscription) => subscription.remove());
    subscriptions = [];
  };

  const listen = () => [
    deps.whatsapp.addListener("messageReceived", (event) => {
      void deps.receive(event).then((result) => {
        if (!result.success) publish({ lastError: { code: result.error.code, message: result.error.message } });
      });
    }),
    deps.whatsapp.addListener("qr", (qr) => publish({ qr })),
    deps.whatsapp.addListener("connectionChanged", ({ state }) => publish(state === "connected" ? { connection: state, qr: null } : { connection: state })),
    deps.whatsapp.addListener("error", (error) => {
      if (informationalErrorCodes.includes(error.code)) publish({ notice: error.code });
      else publish({ lastError: { code: error.code, message: error.message } });
    }),
  ];

  async function start(): Promise<Result<ReceptionHandle, StartError>> {
    const handle: ReceptionHandle = { stop };
    if (subscriptions.length > 0) return ok(handle);

    const session = deps.session();
    if (!session) return err({ code: "NO_SESSION", message: "No Yoyos session" });
    const active = await deps.links.active();
    if (!active.success) return active;
    if (!active.data) return err({ code: "NO_ACTIVE_LINK", message: "No active WhatsApp link" });
    if (active.data.companyId !== session.companyId) return err({ code: "LINK_OF_OTHER_COMPANY", message: "WhatsApp is linked to another company" });

    // The consumer goes first so recovered pending deliveries find it.
    subscriptions = listen();
    const initialized = await deps.whatsapp.initialize();
    if (!initialized.success) { stop(); return initialized; }
    const connected = await deps.whatsapp.connect();
    if (!connected.success) { stop(); return connected; }
    return ok(handle);
  }

  return {
    start,
    stop,
    status: () => status,
    subscribe(listener: (status: ReceptionStatus) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Yoyos sign-out: stops work but neither logs out of WhatsApp nor deletes local data. */
    async signedOut(): Promise<Result<void, WhatsAppError>> {
      deps.sync.stop();
      stop();
      return deps.whatsapp.disconnect();
    },
    async signedIn(): Promise<Result<ReceptionHandle, StartError>> {
      const started = await start();
      if (started.success) deps.sync.wake();
      return started;
    },
  };
}
