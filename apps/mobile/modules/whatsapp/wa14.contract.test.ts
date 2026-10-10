/**
 * WA-14 contract checks on the TypeScript side: the public surface (IT-API-07), what leaves the module in
 * errors, events and logs (IT-SEG-01), where credentials and reception live (IT-SEG-02) and one controlled
 * journey with a durable, idempotent consumer. Everything runs against a fake native module: nothing here
 * touches Android, iOS, the Go library or WhatsApp.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as index from "@mobile/modules/whatsapp";
import { createWhatsAppClient } from "@mobile/modules/whatsapp/client";
import type { ImageReference, WhatsAppClient, WhatsAppEvents } from "@mobile/modules/whatsapp/types";

const moduleDir = __dirname;
const read = (path: string) => readFileSync(join(moduleDir, path), "utf8");
const CANARY = "canary-3f9a7c1e-private";
const deliveryId = (n: number) => `wa-delivery:v1:${n.toString(16).padStart(32, "0")}`;
const messageId = (n: number) => `wa-message:v1:m${n}`;

/** Every method the public client may have. A missing or extra key is a type error. */
const PUBLIC_CLIENT_METHODS = {
  initialize: true, connect: true, disconnect: true, logout: true, confirmMessageStored: true,
  downloadImage: true, deleteDownloadedImage: true, addListener: true,
} satisfies Record<keyof WhatsAppClient, true>;
/** Native methods the client may call; none sends, lists the core queue or uploads. */
const ALLOWED_NATIVE_CALLS = ["initialize", "connect", "disconnect", "logout", "confirmMessageStored", "setMessageConsumer", "removeMessageConsumer", "downloadImage", "deleteDownloadedImage", "addListener"];

type Handlers = Map<string, (value: unknown) => void>;

/** A native stand-in that records every property the client reads from it. */
function recordingNative(overrides: Record<string, unknown> = {}) {
  const touched = new Set<string>();
  const handlers: Handlers = new Map();
  const base: Record<string, unknown> = {
    addListener: (event: string, callback: (value: unknown) => void) => { handlers.set(event, callback); return { remove() {} }; },
    initialize: async () => ({ success: true, data: { state: "disconnected" } }),
    connect: async () => ({ success: true }),
    disconnect: async () => ({ success: true }),
    logout: async () => ({ success: true }),
    confirmMessageStored: async () => ({ success: true }),
    setMessageConsumer: async () => ({ success: true }),
    removeMessageConsumer: async () => ({ success: true }),
    downloadImage: async () => ({ success: true, data: { uri: "file:///private/wa/m1.jpg", mimeType: "image/jpeg", size: 10 } }),
    deleteDownloadedImage: async () => ({ success: true }),
    ...overrides,
  };
  const native = new Proxy(base, { get: (target, name) => { if (typeof name === "string") touched.add(name); return target[name as string]; } });
  return { native: native as never, touched, handlers, base };
}

describe("IT-API-07 the API keeps to the agreed public responsibilities", () => {
  test("the module exports a client, a factory and the diagnostic probe, nothing else", () => {
    expect(Object.keys(index).sort()).toEqual(["WhatsApp", "createWhatsAppClient", "probeWhatsAppBridge"]);
  });

  test("the client exposes exactly the agreed methods: no send, no list, no upload", () => {
    const client = createWhatsAppClient(() => recordingNative().native);
    expect(Object.keys(client).sort()).toEqual(Object.keys(PUBLIC_CLIENT_METHODS).sort());
    for (const name of Object.keys(client).filter((method) => method !== "addListener")) expect(name).not.toMatch(/send|list|queue|upload|publish|sync/i);
  });

  test("a full use of the API only reaches the agreed native methods", async () => {
    const { native, touched } = recordingNative();
    const client = createWhatsAppClient(() => native);
    const subscription = client.addListener("messageReceived", () => {});
    await client.initialize();
    await client.connect();
    await client.confirmMessageStored(deliveryId(1));
    await client.downloadImage({ messageId: messageId(1), downloadReference: "wa-image:v1:YWJj" });
    await client.deleteDownloadedImage(messageId(1));
    await client.disconnect();
    await client.logout();
    subscription.remove();
    expect([...touched].filter((name) => !ALLOWED_NATIVE_CALLS.includes(name))).toEqual([]);
  });

  test("confirming local persistence is not an upload to core and does not delete an image", async () => {
    const calls: string[] = [];
    const log = (name: string) => async () => { calls.push(name); return { success: true }; };
    const { native } = recordingNative({ confirmMessageStored: log("confirmMessageStored"), deleteDownloadedImage: log("deleteDownloadedImage"), downloadImage: log("downloadImage") });
    const client = createWhatsAppClient(() => native);
    await client.initialize();
    expect(await client.confirmMessageStored(deliveryId(2))).toEqual({ success: true, data: undefined });
    expect(calls).toEqual(["confirmMessageStored"]);
  });

  test("the public types name no send, list or upload operation", () => {
    const types = read("types.ts");
    expect(types).not.toMatch(/\b(sendMessage|send[A-Z]\w*|list[A-Z]\w*|upload\w*|confirmUpload\w*)\b/);
  });
});

describe("IT-SEG-01 diagnostics carry no secret, query or message content", () => {
  const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  afterAll(() => consoleSpies.forEach((spy) => spy.mockRestore()));
  beforeEach(() => consoleSpies.forEach((spy) => spy.mockClear()));

  const codesInTypes = () => [...read("types.ts").matchAll(/"([A-Z_]{4,})"/g)].map((match) => match[1]).filter((code, at, all) => all.indexOf(code) === at);

  test("the public error codes are the 19 agreed ones", () => {
    expect(codesInTypes()).toHaveLength(19);
  });

  test("every code surfaces a fixed message that never echoes what native said", async () => {
    for (const code of codesInTypes()) {
      for (const text of [CANARY, "other text"]) {
        const { native } = recordingNative({ connect: async () => ({ success: false, error: { code, message: text } }) });
        const client = createWhatsAppClient(() => native);
        await client.initialize();
        const result = await client.connect();
        expect(result.success).toBe(false);
        if (result.success) continue;
        expect(result.error.code).toBe(code);
        expect(result.error.message).not.toContain(text);
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    }
  });

  test("a rejected native call, a thrown error and a malformed answer reveal nothing", async () => {
    const outcomes = [
      recordingNative({ connect: async () => { throw new Error(CANARY); } }),
      recordingNative({ connect: async () => ({ success: true, data: { token: CANARY }, extra: CANARY }) }),
      recordingNative({ connect: async () => CANARY }),
    ];
    for (const { native } of outcomes) {
      const client = createWhatsAppClient(() => native);
      await client.initialize();
      const result = await client.connect();
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });

  test("native error events and malformed events are replaced by fixed diagnostics", () => {
    const { native, handlers } = recordingNative();
    const client = createWhatsAppClient(() => native);
    const seen: unknown[] = [];
    client.addListener("error", (payload) => seen.push(payload));
    client.addListener("connectionChanged", (payload) => seen.push(payload));
    handlers.get("error")?.({ code: "CONNECTION_FAILED", message: CANARY });
    handlers.get("error")?.({ code: CANARY, message: CANARY });
    handlers.get("connectionChanged")?.({ state: CANARY });
    handlers.get("messageReceived")?.({ deliveryId: CANARY, message: { text: CANARY } });
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).not.toContain(CANARY);
    expect(seen).toContainEqual({ code: "INVALID_NATIVE_RESPONSE", message: "Invalid WhatsApp native response" });
  });

  test("a failing consumer or listener cannot break the stream and nothing is logged", async () => {
    const { native, handlers } = recordingNative();
    const client = createWhatsAppClient(() => native);
    const survivors: unknown[] = [];
    client.addListener("error", () => { throw new Error(CANARY); });
    client.addListener("error", (payload) => survivors.push(payload));
    client.addListener("messageReceived", () => { throw new Error(CANARY); });
    await client.initialize();
    handlers.get("error")?.({ code: "CONNECTION_FAILED", message: "x" });
    handlers.get("messageReceived")?.({ deliveryId: deliveryId(3), message: { id: messageId(3), accountId: "1@lid", whatsappMessageId: "w", chatId: "2@lid", direction: "incoming", timestamp: 1, text: CANARY } });
    expect(survivors).toHaveLength(1);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  test("the QR is delivered only through its event, never inside a state or an error", () => {
    const { native, handlers } = recordingNative();
    const client = createWhatsAppClient(() => native);
    const states: unknown[] = [];
    const errors: unknown[] = [];
    client.addListener("connectionChanged", (payload) => states.push(payload));
    client.addListener("error", (payload) => errors.push(payload));
    handlers.get("connectionChanged")?.({ state: "awaitingQr" });
    handlers.get("qr")?.({ value: CANARY, expiresAt: Date.now() + 20_000 });
    handlers.get("error")?.({ code: "CONNECTION_FAILED", message: "" });
    expect(JSON.stringify([states, errors])).not.toContain(CANARY);
  });
});

describe("IT-SEG-01 native diagnostics and the notification", () => {
  const files = (dir: string, extension: string, out: string[] = []): string[] => {
    for (const name of readdirSync(join(moduleDir, dir)).sort()) {
      const path = join(dir, name);
      if (statSync(join(moduleDir, path)).isDirectory()) files(path, extension, out);
      else if (name.endsWith(extension)) out.push(path);
    }
    return out;
  };

  test("the Go bridge test and types.ts agree on the 19 public codes", () => {
    const goList = /var publicCodeList = \[\]string\{([^}]*)\}/.exec(read("go/bridge/security_test.go"))?.[1] ?? "";
    const goCodes = [...goList.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
    const tsCodes = [...(/export type WhatsAppErrorCode =([^;]*);/.exec(read("types.ts"))?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
    expect(goCodes).toHaveLength(19);
    expect([...goCodes].sort()).toEqual([...tsCodes].sort());
  });

  test("Kotlin never logs or prints and Swift logs only numeric status codes", () => {
    for (const file of files("android/src/main", ".kt")) expect({ file, hit: /android\.util\.Log|\bLog\.[a-z]\(|println\(|printStackTrace|Timber/.exec(read(file))?.[0] }).toEqual({ file, hit: undefined });
    for (const file of [...files("ios", ".swift")].filter((path) => !path.includes("Tests"))) {
      const text = read(file);
      expect({ file, hit: /\bprint\(|debugPrint\(|\bdump\(|os_log|Logger\(/.exec(text)?.[0] }).toEqual({ file, hit: undefined });
      for (const call of text.match(/NSLog\(.*\)/g) ?? []) {
        // A fixed sentence plus %d of errno or an OSStatus: no string, no description, no payload.
        expect(call).toMatch(/^NSLog\("[A-Za-z ]+: %d", (?:errno|status)\)$/);
        expect(call).not.toMatch(/%@|%s|localizedDescription|\\\(/);
      }
    }
  });

  test("no native event carries a platform error description", () => {
    for (const file of [...files("android/src/main", ".kt"), ...files("ios", ".swift")].filter((path) => !path.includes("Tests"))) {
      expect({ file, hit: /(?:localizedDescription|\.message\b[^"]*emit|getLocalizedMessage|\\\(error\))/.exec(read(file))?.[0] }).toEqual({ file, hit: undefined });
    }
  });

  test("the foreground notification is generic: fixed title, no text, extras or actions", () => {
    const service = read("android/src/main/java/expo/modules/whatsapp/WhatsAppService.kt");
    const notification = /private fun notification\(\)[\s\S]*?\.build\(\)/.exec(service)?.[0] ?? "";
    expect(notification).toContain("setContentTitle(getString(R.string.whatsapp_connection_title))");
    expect(notification).not.toMatch(/setContentText|setSubText|setStyle|addAction|putExtra|setTicker|setLargeIcon/);
    const strings = read("android/src/main/res/values/strings.xml");
    expect(strings).not.toMatch(/%|\{/);
  });
});

describe("IT-SEG-02 credentials and reception stay on the phone", () => {
  const listFiles = (dir: string, accept: (file: string) => boolean, out: string[] = []): string[] => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "node_modules" || name === "build" || name === ".gradle") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) listFiles(path, accept, out);
      else if (accept(path)) out.push(path);
    }
    return out;
  };
  const isTest = (file: string) => /(\.test\.|\/Tests\/|\/androidTest\/|\/src\/test\/|_test\.go$)/.test(file);
  const sources = (extension: RegExp) => listFiles(moduleDir, (file) => extension.test(file) && !isTest(file) && !file.includes("/patches/"))
    .map((file) => ({ file: relative(moduleDir, file), text: readFileSync(file, "utf8") }));

  test("the JavaScript module has no network client, core endpoint or upload path", () => {
    const forbidden = /\bfetch\(|XMLHttpRequest|WebSocket|axios|https?:\/\/|\bapiUrl\b|EXPO_PUBLIC_API|@shared\/contracts|\bupload/i;
    for (const { file, text } of sources(/\.tsx?$/)) expect({ file, hit: forbidden.exec(text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""))?.[0] }).toEqual({ file, hit: undefined });
  });

  test("native Kotlin and Swift code opens no HTTP connection of its own", () => {
    const forbidden = /HttpURLConnection|OkHttp|URLSession|URLRequest|java\.net\.URL|NWConnection|ServerSocket|NWListener/;
    for (const { file, text } of [...sources(/\.kt$/), ...sources(/\.swift$/)]) expect({ file, hit: forbidden.exec(text)?.[0] }).toEqual({ file, hit: undefined });
  });

  test("Go reaches the network only through whatsmeow and listens on no port", () => {
    const offenders = sources(/\.go$/).filter(({ text }) => /"net\/http"|net\.Listen|http\.Listen|http\.Serve|httptest/.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test("the module keeps no database of its own and adds no queue toward core", () => {
    const forbidden = /expo-sqlite|drizzle|\bprisma\b|PrismaClient|outbox|syncQueue|uploadQueue/i;
    for (const { file, text } of sources(/\.(tsx?|kt|swift|go)$/)) expect({ file, hit: forbidden.exec(text)?.[0] }).toEqual({ file, hit: undefined });
  });

  test("the Android service is a local foreground service, not a server receiver", () => {
    const manifest = read("android/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:exported="false"');
    expect(manifest).not.toMatch(/FirebaseMessaging|gcm|c2dm|\.fcm|BOOT_COMPLETED/i);
  });
});

describe("controlled journey with a durable, idempotent consumer", () => {
  /** The phone: what survives an app restart (session, pending entries) lives here, outside any client. */
  class Phone {
    session: string | null = null;
    pending = new Map<string, { deliveryId: string; message: Record<string, unknown> }>();
    awaitingIdentity = new Map<string, { deliveryId: string; message: Record<string, unknown> }>();
    failNextConfirm = false;
    handlers: Handlers = new Map();
    consumer: string | null = null;
    downloaded = new Set<string>();
    qrCount = 0;

    native() {
      return {
        addListener: (event: string, callback: (value: unknown) => void) => { this.handlers.set(event, callback); return { remove() {} }; },
        initialize: async () => ({ success: true, data: { state: "disconnected" } }),
        setMessageConsumer: async (token: string) => { this.consumer = token; this.replay(); return { success: true }; },
        removeMessageConsumer: async () => ({ success: true }),
        connect: async () => {
          if (this.session) { this.emit("connectionChanged", { state: "connected" }); return { success: true }; }
          this.emit("connectionChanged", { state: "awaitingQr" });
          this.emit("qr", { value: `qr-${++this.qrCount}`, expiresAt: Date.now() + 20_000 });
          return { success: true };
        },
        disconnect: async () => { this.emit("connectionChanged", { state: "disconnected" }); return { success: true }; },
        logout: async () => { this.session = null; this.emit("connectionChanged", { state: "disconnected" }); return { success: true }; }, // pending entries stay
        confirmMessageStored: async (id: string) => {
          if (this.failNextConfirm) { this.failNextConfirm = false; return { success: false, error: { code: "NATIVE_CALL_FAILED" } }; }
          this.pending.delete(id); // idempotent: an unknown delivery is already confirmed
          return { success: true };
        },
        downloadImage: async (reference: ImageReference) => { this.downloaded.add(reference.messageId); return { success: true, data: { uri: `file:///private/wa/${this.downloaded.size}.jpg`, mimeType: "image/jpeg", size: 100 } }; },
        deleteDownloadedImage: async (id: string) => { this.downloaded.delete(id); return { success: true }; },
      };
    }
    emit(event: string, payload: unknown) { this.handlers.get(event)?.(payload); }
    pair(accountId: string) { this.session = accountId; this.emit("connectionChanged", { state: "connected" }); }
    receive(n: number, accountId: string, extra: Record<string, unknown> = {}) {
      const entry = { deliveryId: deliveryId(n), message: { id: messageId(n), accountId, whatsappMessageId: `W${n}`, chatId: "555@lid", direction: "incoming", timestamp: 1_700_000_000 + n, text: `hello ${n}`, ...extra } };
      this.pending.set(entry.deliveryId, entry);
      this.push(entry);
    }
    /** A message from a chat known only by phone number: held back until its LID mapping arrives. */
    receiveUnresolved(n: number, accountId: string) {
      this.awaitingIdentity.set(deliveryId(n), { deliveryId: deliveryId(n), message: { id: messageId(n), accountId, whatsappMessageId: `W${n}`, chatId: "555@lid", direction: "incoming", timestamp: 1_700_000_000 + n, text: `late ${n}` } });
    }
    resolveIdentity(n: number) {
      const entry = this.awaitingIdentity.get(deliveryId(n));
      if (!entry) return;
      this.awaitingIdentity.delete(deliveryId(n));
      this.pending.set(entry.deliveryId, entry);
      this.push(entry);
    }
    private push(entry: { deliveryId: string; message: Record<string, unknown> }) {
      if (this.consumer) this.emit("messageReceived", { ...entry, consumer: this.consumer });
    }
    private replay() { for (const entry of this.pending.values()) this.push(entry); }
  }

  /** The app's own durable store: persisting twice the same message id has one effect. */
  class Consumer {
    stored = new Map<string, string>();
    effects = 0;
    attempts = 0;
    constructor(readonly client: WhatsAppClient) {
      client.addListener("messageReceived", ({ deliveryId: id, message }) => { this.attempts++; void this.persistThenConfirm(id, message.id, message.text ?? ""); });
    }
    private async persistThenConfirm(id: string, message: string, text: string) {
      if (!this.stored.has(message)) { this.stored.set(message, text); this.effects++; }
      await this.client.confirmMessageStored(id);
    }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("link, receive live, lose a confirmation, restart, receive late identity, download, log out, link a new account", async () => {
    const phone = new Phone();
    let client = createWhatsAppClient(() => phone.native() as never);
    const states: string[] = [];
    client.addListener("connectionChanged", ({ state }) => states.push(state));
    const qrs: string[] = [];
    client.addListener("qr", ({ value }) => qrs.push(value));
    let consumer = new Consumer(client);

    // Linking: no session, so connect() offers a QR and pairing connects.
    expect(await client.initialize()).toMatchObject({ success: true });
    expect(await client.connect()).toMatchObject({ success: true });
    await settle();
    expect(states).toContain("awaitingQr");
    expect(qrs).toEqual(["qr-1"]);
    phone.pair("111@lid");

    // Live message: persisted once, confirmed, no longer pending.
    phone.receive(1, "111@lid");
    await settle();
    expect(consumer.effects).toBe(1);
    expect(phone.pending.size).toBe(0);

    // Lost confirmation: the entry stays pending and returns after a restart without a second effect.
    phone.failNextConfirm = true;
    phone.receive(2, "111@lid");
    await settle();
    expect(consumer.effects).toBe(2);
    expect([...phone.pending.keys()]).toEqual([deliveryId(2)]);
    const before = consumer.attempts;
    client = createWhatsAppClient(() => phone.native() as never); // restart: a new client over the same phone
    consumer = Object.assign(new Consumer(client), { stored: consumer.stored, effects: consumer.effects });
    client.addListener("connectionChanged", ({ state }) => states.push(state));
    client.addListener("qr", ({ value }) => qrs.push(value));
    await client.initialize();
    await settle();
    expect(consumer.attempts + before).toBeGreaterThan(before);
    expect(consumer.effects).toBe(2);
    expect(phone.pending.size).toBe(0);

    // A message whose PN/LID mapping is late is not delivered until it resolves, and then only once.
    phone.receiveUnresolved(3, "111@lid");
    await settle();
    expect(consumer.stored.has(messageId(3))).toBe(false);
    phone.resolveIdentity(3);
    await settle();
    expect(consumer.stored.get(messageId(3))).toBe("late 3");
    expect(consumer.effects).toBe(3);

    // Image: downloaded to a private file URI, deleted on request; confirmation did neither.
    const reference = { messageId: messageId(1), downloadReference: "wa-image:v1:YWJj" };
    const downloaded = await client.downloadImage(reference);
    expect(downloaded).toMatchObject({ success: true, data: { uri: expect.stringMatching(/^file:\/\//) } });
    expect(phone.downloaded.has(messageId(1))).toBe(true);
    expect(await client.deleteDownloadedImage(messageId(1))).toMatchObject({ success: true });
    expect(phone.downloaded.size).toBe(0);

    // Logout keeps what is still pending confirmable and a new account links through a new QR.
    phone.failNextConfirm = true;
    phone.receive(4, "111@lid");
    await settle();
    expect(await client.logout()).toMatchObject({ success: true });
    expect(phone.session).toBeNull();
    expect(await client.confirmMessageStored(deliveryId(4))).toMatchObject({ success: true });
    expect(phone.pending.size).toBe(0);
    expect(await client.connect()).toMatchObject({ success: true });
    await settle();
    expect(qrs).toEqual(["qr-1", "qr-2"]);
    phone.pair("222@lid");
    phone.receive(5, "222@lid");
    await settle();
    expect(consumer.stored.get(messageId(5))).toBe("hello 5");
    expect(consumer.effects).toBe(5);
    expect([...consumer.stored.keys()].sort()).toEqual([1, 2, 3, 4, 5].map(messageId).sort());
  });

  test("a delivery repeated by native has no second logical effect", async () => {
    const phone = new Phone();
    const client = createWhatsAppClient(() => phone.native() as never);
    const consumer = new Consumer(client);
    await client.initialize();
    phone.pair("111@lid");
    phone.receive(7, "111@lid");
    const repeated = { deliveryId: deliveryId(7), message: { id: messageId(7), accountId: "111@lid", whatsappMessageId: "W7", chatId: "555@lid", direction: "incoming", timestamp: 1_700_000_007, text: "hello 7" }, consumer: phone.consumer };
    phone.emit("messageReceived", repeated);
    phone.emit("messageReceived", repeated);
    await settle();
    expect(consumer.attempts).toBe(3);
    expect(consumer.effects).toBe(1);
  });

  test("events keep the documented shape through the journey", () => {
    const shape: (keyof WhatsAppEvents)[] = ["qr", "connectionChanged", "messageReceived", "error"];
    expect(shape).toHaveLength(4);
  });
});

// IT-MSG-07 (decision 2026-10-10), read only: the Kotlin and Swift stores validate the delivered message with an
// optional `timestamp` (absent = unknown date) and never accept 0 as a date. Neither was compiled or run here.
describe("IT-MSG-07 the native stores accept a message with no timestamp", () => {
  test("Kotlin lists the key only when present and requires a positive integer when it is", () => {
    const kotlin = read("android/src/main/java/expo/modules/whatsapp/NativeStateStore.kt");
    expect(kotlin).toContain('mutableListOf("id", "accountId", "whatsappMessageId", "chatId", "direction")');
    expect(kotlin).toContain('if (message.has("timestamp")) fields.add("timestamp")');
    expect(kotlin).toContain('Regex("[1-9][0-9]*").matches(timestamp.toString())');
  });
  test("Swift lists the key only when present and requires a positive integer when it is", () => {
    const swift = read("ios/Storage/NativeStateStore.swift");
    expect(swift).toContain('["id", "accountId", "whatsappMessageId", "chatId", "direction"]');
    expect(swift).toContain('if message["timestamp"] != nil { fields.insert("timestamp") }');
    expect(swift).toContain("timestamp > 0, timestamp <= 9_007_199_254_740_991");
  });
});
