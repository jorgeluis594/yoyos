import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ConnectionState, WhatsAppError, WhatsAppErrorCode, WhatsAppEvents } from "@mobile/modules/whatsapp/types";
import type { GatewayConfigurationError, LinkStore, Session, StoreError, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import type { ReceiveError, ReceiveOutcome } from "@mobile/features/whatsapp/application/receive-message";

export type ReceptionHandle = Readonly<{ stop(): void }>;
export type StartError =
  | Readonly<{ code: "NO_SESSION" | "NO_ACTIVE_LINK" | "LINK_OF_OTHER_COMPANY" | "CANCELLED"; message: string }>
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
  whatsapp: Pick<WhatsAppGateway, "initialize" | "connect" | "disconnect" | "logout" | "addListener">;
  links: LinkStore;
  session: () => Session | null;
  receive: (event: WhatsAppEvents["messageReceived"]) => Promise<Result<ReceiveOutcome, ReceiveError>>;
  sync: Readonly<{ wake(): void; stop(): void }>;
  /** Development diagnostics: event names and codes only, never message content, ids or LIDs. */
  debug?: (event: string, detail?: Readonly<Record<string, string | number | boolean | null>>) => void;
}>;

export function createReceptionLifecycle(deps: ReceptionDeps) {
  let subscriptions: readonly { remove(): void }[] = [];
  let status: ReceptionStatus = { connection: "disconnected", qr: null, notice: null, lastError: null };
  const listeners = new Set<(status: ReceptionStatus) => void>();

  const debug = deps.debug ?? (() => undefined);
  const publish = (next: Partial<ReceptionStatus>) => {
    status = { ...status, ...next };
    listeners.forEach((listener) => listener(status));
  };

  // Concurrent start() calls share one attempt; stop() bumps the generation so an attempt in flight gives up.
  let starting: Promise<Result<ReceptionHandle, StartError>> | null = null;
  let generation = 0;

  const removeSubscriptions = () => {
    subscriptions.forEach((subscription) => subscription.remove());
    subscriptions = [];
  };

  const stop = () => {
    generation += 1;
    starting = null; // an attempt in flight is cancelled; a start() right after must begin its own
    removeSubscriptions();
    publish({ connection: "disconnected", qr: null, notice: null, lastError: null });
  };

  const listen = () => [
    deps.whatsapp.addListener("messageReceived", (event) => {
      debug("message_received", { direction: event.message.direction, hasText: event.message.text !== undefined, hasImage: event.message.image !== undefined, hasTimestamp: event.message.timestamp !== undefined });
      void deps.receive(event).then((result) => {
        debug("message_processed", result.success ? { status: result.data.status } : { errorCode: result.error.code });
        if (!result.success) publish({ lastError: { code: result.error.code, message: result.error.message } });
        else if (status.lastError !== null) publish({ lastError: null });
      });
    }),
    deps.whatsapp.addListener("qr", (qr) => { debug("qr", { expiresAt: qr.expiresAt }); publish({ qr }); }),
    deps.whatsapp.addListener("connectionChanged", ({ state }) => {
      debug("connection_changed", { state });
      publish(state === "connected" ? { connection: state, qr: null, lastError: null } : { connection: state });
    }),
    deps.whatsapp.addListener("error", (error) => {
      debug("library_error", { code: error.code });
      if (informationalErrorCodes.includes(error.code)) publish({ notice: error.code });
      else publish({ lastError: { code: error.code, message: error.message } });
    }),
  ];

  const cancelled = (): Result<never, StartError> => err({ code: "CANCELLED", message: "Reception was stopped while starting" });

  async function doStart(): Promise<Result<ReceptionHandle, StartError>> {
    const handle: ReceptionHandle = { stop };
    const startedGeneration = generation;
    const isStale = () => startedGeneration !== generation;

    const session = deps.session();
    if (!session) return err({ code: "NO_SESSION", message: "No Yoyos session" });
    const active = await deps.links.active();
    if (isStale()) return cancelled();
    if (!active.success) return active;
    if (!active.data) return err({ code: "NO_ACTIVE_LINK", message: "No active WhatsApp link" });
    if (active.data.companyId !== session.companyId) return err({ code: "LINK_OF_OTHER_COMPANY", message: "WhatsApp is linked to another company" });

    // The consumer goes first so recovered pending deliveries find it.
    const mine = listen();
    subscriptions = mine;
    // A stop() that ran meanwhile already removed its subscriptions; only this attempt's own are dropped.
    const abandon = () => {
      mine.forEach((subscription) => subscription.remove());
      if (subscriptions === mine) subscriptions = [];
    };
    const initialized = await deps.whatsapp.initialize();
    debug("initialize", { ok: initialized.success, errorCode: initialized.success ? null : initialized.error.code });
    if (isStale()) { abandon(); return cancelled(); }
    if (!initialized.success) { abandon(); return initialized; }
    const connected = await deps.whatsapp.connect();
    debug("connect", { ok: connected.success, errorCode: connected.success ? null : connected.error.code });
    if (isStale()) { abandon(); return cancelled(); }
    if (!connected.success) { abandon(); return connected; }
    if (status.lastError !== null) publish({ lastError: null });
    return ok(handle);
  }

  function start(): Promise<Result<ReceptionHandle, StartError>> {
    if (subscriptions.length > 0) return Promise.resolve(ok({ stop }));
    if (starting !== null) return starting;
    const attempt = doStart().finally(() => { if (starting === attempt) starting = null; });
    starting = attempt;
    return attempt;
  }

  return {
    start,
    stop,
    /** Asks the library for a fresh QR (or a new connection attempt) while reception is running. */
    connect: () => deps.whatsapp.connect(),
    status: () => status,
    subscribe(listener: (status: ReceptionStatus) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /**
     * Ends the WhatsApp session. Reception stops but pending messages keep syncing (UC-06); the client is
     * initialized first because logout needs it and the link may belong to another company (never started).
     */
    async logout(): Promise<Result<void, WhatsAppError | GatewayConfigurationError>> {
      stop();
      const initialized = await deps.whatsapp.initialize();
      if (!initialized.success) return initialized;
      return deps.whatsapp.logout();
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
