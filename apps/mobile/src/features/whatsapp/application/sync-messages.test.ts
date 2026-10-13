import { err, ok } from "@shared/functional";
import { createSyncWorker, type SyncWorkerDeps } from "@mobile/features/whatsapp/application/sync-messages";
import type { MessageApi, MessageStore, Session, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, CoreMessageId, ImageDownloadReference, LinkId, NativeMessageId, UserId } from "@mobile/features/whatsapp/domain/ids";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { RejectCode } from "@mobile/features/whatsapp/domain/sync-policy";
import type { TransportError } from "@mobile/shared/application/transport-error";

const now = new Date(1_000_000);
const session = (generation = 1): Session => ({ companyId: "c1" as CompanyId, userId: "u1" as UserId, generation });

function message(n: number, companyId = "c1", attempts = 0): StoredMessage {
  return {
    id: `wa-message:v1:m${n}` as NativeMessageId, accountId: "1@lid" as never, chatId: "2@lid" as never, whatsappMessageId: `W${n}` as never,
    direction: "incoming", sentAt: new Date(n), content: { type: "text", text: "t" }, linkId: "l" as LinkId, companyId: companyId as CompanyId,
    coreImageId: null, arrivalSeq: n, storedAt: now, sync: { state: "pending", attempts, nextAttemptAt: now },
  };
}

function imageMessage(n: number, coreImageId: string | null = null, direction: "incoming" | "outgoing" = "incoming"): StoredMessage {
  return { ...message(n), direction, coreImageId, content: { type: "image", caption: null, mimeType: "image/jpeg", size: 5, reference: "wa-image:v1:secret" as ImageDownloadReference } };
}

type Download = Awaited<ReturnType<WhatsAppGateway["downloadImage"]>>;
type Upload = Awaited<ReturnType<SyncWorkerDeps["uploadImage"]>>;
const uploaded = (id = "00000000-0000-4000-8000-0000000000aa") => ok({ id });

function setup(initial: StoredMessage[], respond: (m: StoredMessage) => ReturnType<MessageApi["register"]> | Awaited<ReturnType<MessageApi["register"]>>,
  media: { download?: () => Download; upload?: () => Upload | Promise<Upload> } = {}) {
  const rows = new Map(initial.map((m) => [m.id, m]));
  const sent: string[] = [];
  const marks: string[] = [];
  const retries: { id: string; attempts: number; at: Date }[] = [];
  const calls: string[] = [];
  let currentSession: Session | null = session();
  const store = {
    nextPending: async (companyId: CompanyId, at: Date, limit: number) => ok([...rows.values()]
      .filter((m) => m.companyId === companyId && m.sync.state === "pending" && m.sync.nextAttemptAt <= at).slice(0, limit)),
    nextRetryAt: async (companyId: CompanyId) => {
      const times = [...rows.values()].flatMap((m) => m.companyId === companyId && m.sync.state === "pending" ? [m.sync.nextAttemptAt.getTime()] : []);
      return ok(times.length === 0 ? null : new Date(Math.min(...times)));
    },
    markSynced: async (id: NativeMessageId, core: CoreMessageId) => { marks.push(`synced:${id}`); const m = rows.get(id)!; rows.set(id, { ...m, sync: { state: "synced", coreMessageId: core, syncedAt: now } }); return ok(undefined); },
    markRejected: async (id: NativeMessageId, code: RejectCode) => { marks.push(`rejected:${code}`); const m = rows.get(id)!; rows.set(id, { ...m, sync: { state: "rejected", code, at: now } }); return ok(undefined); },
    saveCoreImageId: async (id: NativeMessageId, imageId: string) => { calls.push(`save:${imageId}`); rows.set(id, { ...rows.get(id)!, coreImageId: imageId }); return ok(undefined); },
    clearCoreImageId: async (id: NativeMessageId) => { calls.push("clear"); rows.set(id, { ...rows.get(id)!, coreImageId: null }); return ok(undefined); },
    markRetry: async (id: NativeMessageId, attempts: number, at: Date) => { retries.push({ id, attempts, at }); const m = rows.get(id)!; rows.set(id, { ...m, sync: { state: "pending", attempts, nextAttemptAt: at } }); return ok(undefined); },
  } as unknown as MessageStore;
  const api: MessageApi = { register: async (m) => { sent.push(m.id); calls.push(`register:${m.coreImageId}`); return respond(rows.get(m.id)!); } };
  const images = {
    downloadImage: async () => { calls.push("download"); return (media.download ?? (() => ok({ uri: "file:///x", mimeType: "image/png", size: 1 })))(); },
    deleteDownloadedImage: async () => { calls.push("delete"); return ok(undefined); },
  } as SyncWorkerDeps["images"];
  const uploadImage: SyncWorkerDeps["uploadImage"] = async (uri, mimeType) => { calls.push(`upload:${uri}:${mimeType}`); return (media.upload ?? (() => uploaded()))(); };
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const worker = createSyncWorker({
    store, api, images, uploadImage, session: () => currentSession, now: () => now, random: () => 0.5,
    schedule: (ms, run) => { const timer = { ms, run, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
  });
  return { worker, sent, marks, retries, rows, timers, calls, setSession: (s: Session | null) => { currentSession = s; } };
}

const stored = (id = "00000000-0000-4000-8000-000000000001") => ok({ status: "stored" as const, messageId: id as CoreMessageId });
const failure = (code: TransportError["code"], status?: number) => err<TransportError>({ code, message: "m", ...(status ? { http: { status, body: {} } } : {}) });

test("sends pending messages one at a time in arrival order", async () => {
  const { worker, sent } = setup([message(2), message(1), message(3)].sort((a, b) => a.arrivalSeq - b.arrivalSeq), () => stored());
  await worker.runOnce();
  expect(sent).toEqual([message(1).id, message(2).id, message(3).id]);
});

test("marks stored and duplicate responses as synced with the core message id", async () => {
  const { worker, rows } = setup([message(1), message(2)], (m) => ok({ status: m.arrivalSeq === 1 ? "stored" as const : "duplicate" as const, messageId: `core-${m.arrivalSeq}` as CoreMessageId }));
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 2, retried: 0, rejected: 0 } });
  expect(rows.get(message(2).id)?.sync).toMatchObject({ state: "synced", coreMessageId: "core-2" });
});

test("marks permanent rejections and continues with the next message", async () => {
  const { worker, sent, marks } = setup([message(1), message(2)], (m) => m.arrivalSeq === 1 ? failure("API_ERROR", 400) : stored());
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 1, retried: 0, rejected: 1 } });
  expect(sent).toHaveLength(2);
  expect(marks[0]).toBe("rejected:INVALID_INPUT");
});

test("schedules a retry with backoff for retryable errors", async () => {
  const { worker, retries, timers, sent } = setup([message(1, "c1", 2), message(2)], () => failure("SERVER_ERROR", 500));
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 2, rejected: 0 } });
  expect(sent).toHaveLength(2);
  expect(retries[0]).toMatchObject({ attempts: 3, at: new Date(now.getTime() + 8000) });
  expect(retries[1]).toMatchObject({ attempts: 1, at: new Date(now.getTime() + 2000) });
  expect(timers).toHaveLength(1);
  expect(timers[0]?.ms).toBe(2000);
});

test("stops the batch after a network or rate-limit error", async () => {
  for (const code of ["NETWORK_ERROR", "RATE_LIMITED"] as const) {
    const { worker, sent } = setup([message(1), message(2)], () => failure(code));
    await worker.runOnce();
    expect(sent).toHaveLength(1);
  }
});

test("never sends messages of another company", async () => {
  const { worker, sent } = setup([message(1, "c2"), message(2)], () => stored());
  await worker.runOnce();
  expect(sent).toEqual([message(2).id]);
});

test("leaves the message pending without an attempt when the session generation changes mid-run", async () => {
  let ctx: ReturnType<typeof setup> | undefined;
  ctx = setup([message(1), message(2)], () => { ctx?.setSession(session(2)); return failure("OPERATION_CANCELLED"); });
  expect(await ctx.worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 0 } });
  expect(ctx.sent).toHaveLength(1);
  expect(ctx.retries).toEqual([]);
  expect(ctx.rows.get(message(1).id)?.sync).toMatchObject({ state: "pending", attempts: 0 });
});

test("stops with SESSION_BLOCKED without changing any message", async () => {
  const { worker, marks, retries, rows } = setup([message(1), message(2)], () => failure("UNAUTHENTICATED", 401));
  expect(await worker.runOnce()).toMatchObject({ success: false, error: { code: "SESSION_BLOCKED" } });
  expect(marks).toEqual([]);
  expect(retries).toEqual([]);
  expect(rows.get(message(1).id)?.sync.state).toBe("pending");
});

test("returns NO_SESSION and sends nothing without a session", async () => {
  const { worker, sent, setSession } = setup([message(1)], () => stored());
  setSession(null);
  expect(await worker.runOnce()).toMatchObject({ success: false, error: { code: "NO_SESSION" } });
  expect(sent).toEqual([]);
});

test("starts a single run for several wakes while idle", async () => {
  const { worker, sent } = setup([message(1)], () => stored());
  worker.wake(); worker.wake(); worker.wake();
  await new Promise((resolve) => setImmediate(resolve));
  expect(sent).toHaveLength(1);
});

test("runs exactly once more when woken during a run", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const ctx = setup([message(1)], async () => { calls += 1; await gate; return stored(); });
  ctx.worker.wake();
  await new Promise((resolve) => setImmediate(resolve));
  ctx.rows.set(message(2).id, message(2));
  ctx.worker.wake(); ctx.worker.wake();
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toBe(2);
  expect(ctx.sent).toEqual([message(1).id, message(2).id]);
});

test("keeps syncing pending messages of an ended link of the same company", async () => {
  const ended = { ...message(1), linkId: "old-link" as LinkId };
  const { worker, sent } = setup([ended], () => stored());
  await worker.runOnce();
  expect(sent).toEqual([ended.id]);
});

test("stop cancels the scheduled retry", async () => {
  const { worker, timers } = setup([message(1)], () => failure("SERVER_ERROR", 500));
  await worker.runOnce();
  worker.stop();
  expect(timers[0]?.cancelled).toBe(true);
});

test("reports synced, retried and rejected counts", async () => {
  const { worker } = setup([message(1), message(2), message(3)], (m) => m.arrivalSeq === 1 ? stored() : m.arrivalSeq === 2 ? failure("SERVER_ERROR", 500) : failure("API_ERROR", 413));
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 1, retried: 1, rejected: 1 } });
});

test("rejects a message that fails local contract validation instead of retrying it", async () => {
  const { worker, marks, retries } = setup([message(1)], () => err({ code: "INVALID_MESSAGE", message: "m" }));
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 1 } });
  expect(marks).toEqual(["rejected:INVALID_INPUT"]);
  expect(retries).toHaveLength(0);
});

test("schedules a timer for pending messages retried by an earlier run", async () => {
  const later: StoredMessage = { ...message(1), sync: { state: "pending", attempts: 3, nextAttemptAt: new Date(now.getTime() + 300_000) } };
  const { worker, sent, timers } = setup([later], () => stored());
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 0 } });
  expect(sent).toHaveLength(0);
  expect(timers).toHaveLength(1);
  expect(timers[0]?.ms).toBe(300_000);
});

test("waits for the backoff when a network error stops a batch with due messages left", async () => {
  const { worker, sent, timers } = setup([message(1), message(2)], () => failure("NETWORK_ERROR"));
  await worker.runOnce();
  expect(sent).toHaveLength(1);
  expect(timers).toHaveLength(1);
  expect(timers[0]?.ms).toBe(2000);
});

test("does not schedule a timer after the operation is cancelled", async () => {
  const { worker, sent, timers } = setup([message(1), message(2)], () => failure("OPERATION_CANCELLED"));
  await worker.runOnce();
  expect(sent).toHaveLength(1);
  expect(timers).toHaveLength(0);
});

const aa = "00000000-0000-4000-8000-0000000000aa";
const wa = (code: string) => err({ code, message: "m" }) as Download;

test("downloads, uploads with the real mimeType, saves coreImageId and registers an image message", async () => {
  const { worker, calls, rows } = setup([imageMessage(1)], () => stored());
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 1, retried: 0, rejected: 0 } });
  expect(calls).toEqual(["download", `upload:file:///x:image/png`, "delete", `save:${aa}`, `register:${aa}`]);
  expect(rows.get(imageMessage(1).id)?.coreImageId).toBe(aa);
});

test("does not download or upload again when coreImageId exists", async () => {
  const { worker, calls } = setup([imageMessage(1, aa)], () => stored());
  await worker.runOnce();
  expect(calls).toEqual([`register:${aa}`]);
});

test("deletes the downloaded file after a successful upload and after a failed one", async () => {
  const ok1 = setup([imageMessage(1)], () => stored());
  await ok1.worker.runOnce();
  expect(ok1.calls).toContain("delete");
  const failed = setup([imageMessage(1)], () => stored(), { upload: () => failure("SERVER_ERROR", 500) });
  await failed.worker.runOnce();
  expect(failed.calls).toEqual(["download", "upload:file:///x:image/png", "delete"]);
  expect(failed.sent).toEqual([]);
});

test("registers text messages without touching images", async () => {
  const { worker, calls } = setup([message(1)], () => stored());
  await worker.runOnce();
  expect(calls).toEqual(["register:null"]);
});

test("uploads outgoing images too", async () => {
  const { worker, calls } = setup([imageMessage(1, null, "outgoing")], () => stored());
  await worker.runOnce();
  expect(calls).toContain("upload:file:///x:image/png");
});

test("clears coreImageId on 404 so the next run uploads again", async () => {
  let first = true;
  const ctx = setup([imageMessage(1)], () => { if (first) { first = false; return failure("API_ERROR", 404); } return stored(); });
  expect(await ctx.worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 1, rejected: 0 } });
  expect(ctx.rows.get(imageMessage(1).id)?.coreImageId).toBeNull();
  expect(ctx.calls).toContain("clear");
  ctx.calls.length = 0;
  ctx.rows.set(imageMessage(1).id, { ...ctx.rows.get(imageMessage(1).id)!, sync: { state: "pending", attempts: 1, nextAttemptAt: now } });
  await ctx.worker.runOnce();
  expect(ctx.calls).toEqual(["download", "upload:file:///x:image/png", "delete", `save:${aa}`, `register:${aa}`]);
});

test("rejects an expired WhatsApp image without registering it", async () => {
  const { worker, marks, sent } = setup([imageMessage(1)], () => stored(), { download: () => wa("IMAGE_UNAVAILABLE") });
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 1 } });
  expect(marks).toEqual(["rejected:IMAGE_UNAVAILABLE"]);
  expect(sent).toEqual([]);
});

test("classifies an upload failure by its HTTP status", async () => {
  const blocked = setup([imageMessage(1)], () => stored(), { upload: () => err({ code: "API_ERROR", message: "m", http: { status: 403 } }) });
  expect(await blocked.worker.runOnce()).toMatchObject({ success: false, error: { code: "SESSION_BLOCKED" } });
  const rejected = setup([imageMessage(1)], () => stored(), { upload: () => err({ code: "API_ERROR", message: "m", http: { status: 400 } }) });
  expect(await rejected.worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 0, rejected: 1 } });
  expect(rejected.sent).toEqual([]);
});

test("leaves the message pending when WhatsApp is disconnected", async () => {
  const { worker, retries, sent, rows } = setup([imageMessage(1)], () => stored(), { download: () => wa("ACCOUNT_NOT_CONNECTED") });
  expect(await worker.runOnce()).toEqual({ success: true, data: { synced: 0, retried: 1, rejected: 0 } });
  expect(retries).toHaveLength(1);
  expect(sent).toEqual([]);
  expect(rows.get(imageMessage(1).id)?.sync.state).toBe("pending");
});

test("retries a failed registration with the same imageId", async () => {
  let attempt = 0;
  const ctx = setup([imageMessage(1)], () => (attempt++ === 0 ? failure("SERVER_ERROR", 500) : stored()));
  await ctx.worker.runOnce();
  ctx.rows.set(imageMessage(1).id, { ...ctx.rows.get(imageMessage(1).id)!, sync: { state: "pending", attempts: 1, nextAttemptAt: now } });
  await ctx.worker.runOnce();
  expect(ctx.calls.filter((call) => call.startsWith("upload"))).toHaveLength(1);
  expect(ctx.calls.filter((call) => call.startsWith("register"))).toEqual([`register:${aa}`, `register:${aa}`]);
});
