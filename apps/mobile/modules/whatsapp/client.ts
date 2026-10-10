import { requireOptionalNativeModule } from "expo";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { WhatsAppClient, WhatsAppError, WhatsAppErrorCode, WhatsAppEvents, WhatsAppOptions } from "@mobile/modules/whatsapp/types";

const codes = ["MODULE_UNAVAILABLE", "NOT_INITIALIZED", "INVALID_INPUT", "INVALID_NATIVE_RESPONSE", "NATIVE_CALL_FAILED", "CONNECTION_FAILED", "SESSION_EXPIRED", "SESSION_STORAGE_FAILED", "SESSION_STORAGE_LIMIT_REACHED", "SESSION_STATE_INVALID", "IDENTITY_UNAVAILABLE", "ACCOUNT_NOT_CONNECTED", "RECOVERY_BUFFER_FULL", "HISTORY_LIMIT_REACHED", "STORAGE_LIMIT_REACHED", "IMAGE_UNAVAILABLE", "IMAGE_DOWNLOAD_FAILED", "IMAGE_DELETE_FAILED", "REMOTE_LOGOUT_UNCONFIRMED"] as const;
const codeSchema = z.enum(codes);
const states = z.enum(["disconnected", "connecting", "awaitingQr", "connected", "reconnecting", "sessionExpired"]);
const messageId = z.string().regex(/^wa-message:v1:[A-Za-z0-9_-]+$/);
const imageReference = z.object({ messageId, downloadReference: z.string().max(16384).regex(/^wa-image:v1:[A-Za-z0-9_-]+$/) }).strict();
const message = z.object({
  id: messageId, accountId: z.string().regex(/^[0-9]+@lid$/), whatsappMessageId: z.string().min(1), chatId: z.string().regex(/^[0-9]+@lid$/),
  direction: z.enum(["incoming", "outgoing"]), timestamp: z.number().int().nonnegative().safe(), text: z.string().optional(),
  image: z.object({ mimeType: z.string().min(1).optional(), size: z.number().int().nonnegative().optional(), reference: imageReference }).strict().optional(),
}).strict();
const eventSchemas = {
  qr: z.object({ value: z.string().min(1), expiresAt: z.number().int().positive() }).strict(),
  connectionChanged: z.object({ state: states }).strict(),
  // `consumer` names the subscription a delivery was emitted to; a replaced one is dropped here too.
  messageReceived: z.object({ deliveryId: z.string().regex(/^wa-delivery:v1:[0-9a-f]{32}$/), message, consumer: z.string().min(1).optional() }).strict(),
  error: z.object({ code: codeSchema, message: z.string() }).strict(),
};
const optionsSchema = z.object({ maxImageStorageBytes: z.number().int().positive().safe().optional(), maxRecoveryBufferBytes: z.number().int().positive().safe().optional() }).strict();
// A downloaded image is a private file URI plus its verified MIME and size; never bytes or base64.
const imageSchema = z.object({ uri: z.string().startsWith("file://").max(4096), mimeType: z.string().regex(/^image\/[A-Za-z0-9.+-]+$/), size: z.number().int().positive().safe() }).strict();
const success = z.object({ success: z.literal(true), data: z.unknown().optional() }).strict();
const failure = z.object({ success: z.literal(false), error: z.object({ code: codeSchema, message: z.string().optional() }).strict() }).strict();
const nativeResult = z.union([success, failure]);
type NativeWhatsApp = {
  initialize(options: WhatsAppOptions): Promise<unknown>;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  logout(): Promise<unknown>;
  confirmMessageStored(id: string): Promise<unknown>;
  setMessageConsumer(token: string): Promise<unknown>;
  removeMessageConsumer(token: string): Promise<unknown>;
  downloadImage(reference: z.infer<typeof imageReference>): Promise<unknown>;
  deleteDownloadedImage(id: string): Promise<unknown>;
  addListener(event: keyof WhatsAppEvents, listener: (payload: unknown) => void): { remove(): void };
};
type ListenerEntry<E extends keyof WhatsAppEvents> = { listener: (payload: WhatsAppEvents[E]) => void };
/** The single active messageReceived subscription; `token` is its identity toward native. */
type Consumer = { token: string; listener: (payload: WhatsAppEvents["messageReceived"]) => void; registered: boolean };

const diagnostics: Record<WhatsAppErrorCode, string> = {
  MODULE_UNAVAILABLE: "WhatsApp native module is unavailable", NOT_INITIALIZED: "WhatsApp is not initialized",
  INVALID_INPUT: "Invalid WhatsApp input", INVALID_NATIVE_RESPONSE: "Invalid WhatsApp native response",
  NATIVE_CALL_FAILED: "WhatsApp native call failed", CONNECTION_FAILED: "WhatsApp connection failed",
  SESSION_EXPIRED: "WhatsApp session expired", SESSION_STORAGE_FAILED: "WhatsApp session storage failed",
  SESSION_STORAGE_LIMIT_REACHED: "WhatsApp session storage limit reached", SESSION_STATE_INVALID: "WhatsApp session state is invalid",
  IDENTITY_UNAVAILABLE: "WhatsApp identity is unavailable", ACCOUNT_NOT_CONNECTED: "WhatsApp account is not connected",
  RECOVERY_BUFFER_FULL: "WhatsApp recovery buffer is full", HISTORY_LIMIT_REACHED: "WhatsApp history limit reached",
  STORAGE_LIMIT_REACHED: "WhatsApp storage limit reached", IMAGE_UNAVAILABLE: "WhatsApp image is unavailable",
  IMAGE_DOWNLOAD_FAILED: "WhatsApp image download failed", IMAGE_DELETE_FAILED: "WhatsApp image deletion failed",
  REMOTE_LOGOUT_UNCONFIRMED: "WhatsApp remote logout was not confirmed",
};
const failureResult = (code: WhatsAppErrorCode): Result<never, WhatsAppError> => err({ code, message: diagnostics[code] });

let clientCount = 0;

export function createWhatsAppClient(resolveNative: () => NativeWhatsApp | null = () => requireOptionalNativeModule<NativeWhatsApp>("WhatsApp"), now: () => number = Date.now): WhatsAppClient {
  let native: NativeWhatsApp | null = null;
  let prepared = false;
  let localReady = false;
  let initializing: Promise<Result<void, WhatsAppError>> | null = null;
  let activeOptions = "";
  let initializingOptions = "";
  let sessionInvalid = false;
  let state: WhatsAppEvents["connectionChanged"] | null = null;
  let qr: WhatsAppEvents["qr"] | null = null;
  let consumer: Consumer | null = null;
  const instance = ++clientCount; // tokens stay unique when a recreated runtime builds another client
  let consumerCount = 0;
  const listeners = {
    qr: new Set<ListenerEntry<"qr">>(),
    connectionChanged: new Set<ListenerEntry<"connectionChanged">>(),
    error: new Set<ListenerEntry<"error">>(),
  };

  function emit<E extends Exclude<keyof WhatsAppEvents, "messageReceived">>(event: E, payload: WhatsAppEvents[E]) {
    for (const entry of listeners[event] as Set<ListenerEntry<E>>) {
      try { entry.listener(payload); } catch { /* A consumer callback cannot break the native event stream. */ }
    }
  }
  function receive<E extends keyof WhatsAppEvents>(event: E, payload: unknown) {
    const parsed = eventSchemas[event].safeParse(payload);
    if (!parsed.success) { emit("error", { code: "INVALID_NATIVE_RESPONSE", message: diagnostics.INVALID_NATIVE_RESPONSE }); return; }
    if (event === "messageReceived") { deliver(parsed.data as z.infer<typeof eventSchemas.messageReceived>); return; }
    const value = parsed.data as WhatsAppEvents[Exclude<E, "messageReceived">];
    if (event === "connectionChanged") {
      state = value as WhatsAppEvents["connectionChanged"];
      if (state.state !== "awaitingQr") qr = null;
    }
    if (event === "qr") {
      const next = value as WhatsAppEvents["qr"];
      if (state?.state !== "awaitingQr" || next.expiresAt <= now()) return;
      qr = next;
    }
    if (event === "error") {
      const error = value as WhatsAppError;
      emit("error", { code: error.code, message: diagnostics[error.code] });
    } else emit(event as "qr" | "connectionChanged", value as never);
  }
  /** Hands a delivery to the current consumer only; emissions aimed at a replaced one are dropped. */
  function deliver({ consumer: target, ...payload }: z.infer<typeof eventSchemas.messageReceived>) {
    const current = consumer;
    if (!current || (target !== undefined && target !== current.token)) return;
    try { current.listener(payload as WhatsAppEvents["messageReceived"]); } catch { /* A consumer callback cannot break the native event stream. */ }
  }
  /** Registers the consumer with native once local recovery is possible; one attempt, no retry timer. */
  async function registerConsumer(target: Consumer) {
    if (!localReady || consumer !== target || target.registered) return;
    target.registered = true;
    const result = await call("setMessageConsumer", [target.token], empty);
    if (!result.success && consumer === target) {
      target.registered = false;
      emit("error", { code: result.error.code, message: diagnostics[result.error.code] });
    }
  }
  function removeConsumer(target: Consumer) {
    if (consumer !== target) return; // a replaced subscription's remove() changes nothing
    consumer = null;
    if (target.registered) void call("removeMessageConsumer", [target.token], empty);
  }
  function module(): NativeWhatsApp | null {
    if (native) return native;
    try { native = resolveNative(); } catch { return null; }
    if (!native) return null;
    const subscriptions: Array<{ remove(): void }> = [];
    for (const event of ["connectionChanged", "qr", "messageReceived", "error"] as const) {
      try { subscriptions.push(native.addListener(event, (payload) => receive(event, payload))); }
      catch { for (const subscription of subscriptions) subscription.remove(); native = null; return null; }
    }
    return native;
  }
  async function call<T>(method: keyof Pick<NativeWhatsApp, "initialize" | "connect" | "disconnect" | "logout" | "confirmMessageStored" | "setMessageConsumer" | "removeMessageConsumer" | "downloadImage" | "deleteDownloadedImage">, args: unknown[], parse: (data: unknown) => T | null): Promise<Result<T, WhatsAppError>> {
    const target = module();
    if (!target) return failureResult("MODULE_UNAVAILABLE");
    if (typeof target[method] !== "function") return failureResult("NATIVE_CALL_FAILED");
    try {
      const raw = await (target[method] as (...args: unknown[]) => Promise<unknown>)(...args);
      const result = nativeResult.safeParse(raw);
      if (!result.success) return failureResult("INVALID_NATIVE_RESPONSE");
      if (!result.data.success) return failureResult(result.data.error.code);
      const data = parse(result.data.data);
      return data === null ? failureResult("INVALID_NATIVE_RESPONSE") : ok(data);
    } catch { return failureResult("NATIVE_CALL_FAILED"); }
  }
  const empty = (data: unknown) => data === undefined || data === null ? undefined : null;
  async function initialize(options: WhatsAppOptions = {}): Promise<Result<void, WhatsAppError>> {
    if (!optionsSchema.safeParse(options).success) return failureResult("INVALID_INPUT");
    const effective = JSON.stringify({ maxImageStorageBytes: options.maxImageStorageBytes ?? 50 * 1024 * 1024, maxRecoveryBufferBytes: options.maxRecoveryBufferBytes ?? 10 * 1024 * 1024 });
    if (initializing) return effective === initializingOptions ? initializing : failureResult("INVALID_INPUT");
    if (prepared && effective === activeOptions) return ok(undefined);
    initializingOptions = effective;
    const wasPrepared = prepared;
    initializing = (async () => {
      const result = await call("initialize", [options], (data) => {
        const parsed = z.object({ state: states, qr: eventSchemas.qr.optional() }).strict().safeParse(data);
        return parsed.success ? parsed.data : null;
      });
      if (result.success) {
        prepared = localReady = true;
        sessionInvalid = false;
        activeOptions = effective;
        receive("connectionChanged", { state: result.data.state });
        if (result.data.qr) receive("qr", result.data.qr);
        if (consumer) { consumer.registered = false; void registerConsumer(consumer); }
        return ok(undefined);
      }
      // INVALID_INPUT from a prepared module is native refusing different options while reception is
      // requested (or the values themselves): it decides before it stops or publishes anything, so the
      // running module is untouched and stays usable. Any other failure may have published the options
      // without an answer, so the next initialize must reach native and reread the published state.
      if (wasPrepared && result.error.code === "INVALID_INPUT") return result;
      prepared = false;
      activeOptions = "";
      if (result.error.code === "SESSION_STATE_INVALID") {
        localReady = true; prepared = false; sessionInvalid = true;
        receive("connectionChanged", { state: "disconnected" });
        // Pending entries stay recoverable and confirmable while the session itself is invalid.
        if (consumer) { consumer.registered = false; void registerConsumer(consumer); }
      }
      return result;
    })();
    const result = await initializing;
    initializing = null;
    initializingOptions = "";
    return result;
  }
  /** Simultaneous logouts share one native call and its result; later admissions wait for it. */
  let loggingOut: Promise<Result<void, WhatsAppError>> | null = null;
  async function operation(method: "connect" | "disconnect" | "logout"): Promise<Result<void, WhatsAppError>> {
    if (!module()) return failureResult("MODULE_UNAVAILABLE");
    if (method === "logout" && loggingOut) return loggingOut;
    if (loggingOut) await loggingOut;
    if (method === "connect" && sessionInvalid) return failureResult("SESSION_STATE_INVALID");
    if (!prepared && !(method !== "connect" && localReady)) return failureResult("NOT_INITIALIZED");
    if (method !== "logout") return call(method, [], empty);
    loggingOut = logout();
    try { return await loggingOut; } finally { loggingOut = null; }
  }
  /** Unconfirmed remote unlink still retired the local session; any other failure kept it. */
  async function logout(): Promise<Result<void, WhatsAppError>> {
    const result = await call("logout", [], empty);
    if (result.success || result.error.code === "REMOTE_LOGOUT_UNCONFIRMED") {
      prepared = localReady = true;
      sessionInvalid = false;
      receive("connectionChanged", { state: "disconnected" });
    }
    return result;
  }
  return {
    initialize,
    connect: () => operation("connect"), disconnect: () => operation("disconnect"), logout: () => operation("logout"),
    confirmMessageStored: (id) => {
      if (!/^wa-delivery:v1:[0-9a-f]{32}$/.test(id)) return Promise.resolve(failureResult("INVALID_INPUT"));
      if (!module()) return Promise.resolve(failureResult("MODULE_UNAVAILABLE"));
      if (!localReady) return Promise.resolve(failureResult("NOT_INITIALIZED"));
      return call("confirmMessageStored", [id], empty);
    },
    downloadImage: (reference) => {
      if (!imageReference.safeParse(reference).success) return Promise.resolve(failureResult("INVALID_INPUT"));
      if (!module()) return Promise.resolve(failureResult("MODULE_UNAVAILABLE"));
      if (!localReady) return Promise.resolve(failureResult("NOT_INITIALIZED"));
      return call("downloadImage", [reference], (data) => imageSchema.safeParse(data).data ?? null);
    },
    deleteDownloadedImage: (id) => {
      if (!messageId.safeParse(id).success) return Promise.resolve(failureResult("INVALID_INPUT"));
      if (!module()) return Promise.resolve(failureResult("MODULE_UNAVAILABLE"));
      if (!localReady) return Promise.resolve(failureResult("NOT_INITIALIZED"));
      return call("deleteDownloadedImage", [id], empty);
    },
    addListener<E extends keyof WhatsAppEvents>(event: E, listener: (payload: WhatsAppEvents[E]) => void) {
      if (event === "messageReceived") {
        // The latest subscription becomes the only consumer and activates local recovery.
        const entry: Consumer = { token: `consumer-${instance}-${++consumerCount}`, listener: listener as Consumer["listener"], registered: false };
        // Registering the new token replaces the old one atomically in native; removing the old
        // one first would leave a window with no consumer that stops reception.
        consumer = entry;
        module();
        void registerConsumer(entry);
        return { remove: () => removeConsumer(entry) };
      }
      const set = listeners[event as Exclude<E, "messageReceived">] as unknown as Set<ListenerEntry<E>>;
      const entry = { listener };
      set.add(entry);
      module();
      const current = event === "connectionChanged" ? state : event === "qr" ? qr : null;
      if (current) queueMicrotask(() => {
        if (!set.has(entry)) return;
        if (event === "connectionChanged" && current !== state) return;
        if (event === "qr" && (current !== qr || state?.state !== "awaitingQr" || qr.expiresAt <= now())) return;
        try { listener(current as WhatsAppEvents[E]); } catch { /* Listener failure cannot affect another subscription. */ }
      });
      return { remove: () => { set.delete(entry); } };
    },
  };
}

export const WhatsApp = createWhatsAppClient();
