import { err, ok } from "@shared/functional";
import { createSyncWorker } from "@mobile/features/whatsapp/application/sync-messages";
import type { MessageApi, MessageStore, Session } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, CoreMessageId, LinkId, NativeMessageId, UserId } from "@mobile/features/whatsapp/domain/ids";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { RejectCode } from "@mobile/features/whatsapp/domain/sync-policy";
import type { TransportError } from "@mobile/shared/application/transport-error";

const now = new Date(1_000_000);
const session = (generation = 1): Session => ({ companyId: "c1" as CompanyId, userId: "u1" as UserId, generation });

function message(n: number, companyId = "c1", attempts = 0): StoredMessage {
  return {
    id: `wa-message:v1:m${n}` as NativeMessageId, accountId: "1@lid" as never, chatId: "2@lid" as never, whatsappMessageId: `W${n}` as never,
    direction: "incoming", sentAt: new Date(n), content: { type: "text", text: "t" }, linkId: "l" as LinkId, companyId: companyId as CompanyId,
    arrivalSeq: n, storedAt: now, sync: { state: "pending", attempts, nextAttemptAt: now },
  };
}

function setup(initial: StoredMessage[], respond: (m: StoredMessage) => ReturnType<MessageApi["register"]> | Awaited<ReturnType<MessageApi["register"]>>) {
  const rows = new Map(initial.map((m) => [m.id, m]));
  const sent: string[] = [];
  const marks: string[] = [];
  const retries: { id: string; attempts: number; at: Date }[] = [];
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
    markRetry: async (id: NativeMessageId, attempts: number, at: Date) => { retries.push({ id, attempts, at }); const m = rows.get(id)!; rows.set(id, { ...m, sync: { state: "pending", attempts, nextAttemptAt: at } }); return ok(undefined); },
  } as unknown as MessageStore;
  const api: MessageApi = { register: async (m) => { sent.push(m.id); return respond(rows.get(m.id)!); } };
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const worker = createSyncWorker({
    store, api, session: () => currentSession, now: () => now, random: () => 0.5,
    schedule: (ms, run) => { const timer = { ms, run, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
  });
  return { worker, sent, marks, retries, rows, timers, setSession: (s: Session | null) => { currentSession = s; } };
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
