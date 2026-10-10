import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Clock, MessageApi, MessageStore, Session, StoreError } from "@mobile/features/whatsapp/application/ports";
import { classifyFailure, retryDelayMs } from "@mobile/features/whatsapp/domain/sync-policy";

export type SyncSummary = Readonly<{ synced: number; retried: number; rejected: number }>;
export type SyncError = StoreError | Readonly<{ code: "NO_SESSION" | "SESSION_BLOCKED"; message: string }>;

export type SyncWorkerDeps = Readonly<{
  store: MessageStore;
  api: MessageApi;
  session: () => Session | null;
  now: Clock;
  /** A value in [0, 1) used for backoff jitter. */
  random: () => number;
  schedule: (ms: number, run: () => void) => () => void;
  debug?: (event: string, detail?: Readonly<Record<string, string | number | boolean | null>>) => void;
}>;

const batchSize = 20;

export function createSyncWorker(deps: SyncWorkerDeps) {
  let queued = false;
  let running = false;
  let rerun = false;
  let epoch = 0;
  let cancelTimer: (() => void) | null = null;

  const clearTimer = () => { cancelTimer?.(); cancelTimer = null; };

  async function runOnce(): Promise<Result<SyncSummary, SyncError>> {
    const session = deps.session();
    if (!session) return err({ code: "NO_SESSION", message: "No Yoyos session" });
    const startedEpoch = epoch;
    const unchanged = () => startedEpoch === epoch && deps.session()?.generation === session.generation && deps.session()?.companyId === session.companyId;
    let synced = 0, retried = 0, rejected = 0;
    // Why the loop stopped early; the due messages left behind must not be retried before the backoff.
    let stoppedFor: "batch" | "cancel" | null = null;
    let batchBackoffMs = 0;

    batches: while (unchanged()) {
      const pending = await deps.store.nextPending(session.companyId, deps.now(), batchSize);
      if (!pending.success) return pending;
      if (pending.data.length === 0) break;
      for (const message of pending.data) {
        if (!unchanged()) break batches;
        if (message.companyId !== session.companyId) continue;
        const sent = await deps.api.register(message);
        if (sent.success) {
          const marked = await deps.store.markSynced(message.id, sent.data.messageId, deps.now());
          if (!marked.success) return marked;
          synced += 1;
          continue;
        }
        const decision = classifyFailure({ code: sent.error.code, httpStatus: "http" in sent.error ? sent.error.http?.status ?? null : null });
        if (decision.action === "cancel") { stoppedFor = "cancel"; break batches; }
        if (decision.action === "block") return err({ code: "SESSION_BLOCKED", message: "Core rejected the session" });
        if (decision.action === "reject") {
          const marked = await deps.store.markRejected(message.id, decision.code, deps.now());
          if (!marked.success) return marked;
          rejected += 1;
          continue;
        }
        const attempts = message.sync.state === "pending" ? message.sync.attempts + 1 : 1;
        const delay = retryDelayMs(attempts, deps.random());
        const marked = await deps.store.markRetry(message.id, attempts, new Date(deps.now().getTime() + delay));
        if (!marked.success) return marked;
        retried += 1;
        if (decision.stopBatch) { stoppedFor = "batch"; batchBackoffMs = delay; break batches; }
      }
    }
    if (stoppedFor !== "cancel" && unchanged()) {
      const next = await deps.store.nextRetryAt(session.companyId);
      if (!next.success) return next;
      if (next.data !== null && unchanged()) {
        clearTimer();
        const untilNext = Math.max(0, next.data.getTime() - deps.now().getTime());
        cancelTimer = deps.schedule(stoppedFor === "batch" ? Math.max(untilNext, batchBackoffMs) : untilNext, wake);
      }
    }
    return ok({ synced, retried, rejected });
  }

  async function drain(): Promise<void> {
    const debug = deps.debug ?? (() => undefined);
    running = true;
    try {
      do {
        rerun = false;
        const result = await runOnce();
        debug("sync_run", result.success ? { ...result.data } : { errorCode: result.error.code });
        if (!result.success) rerun = false;
      } while (rerun);
    } finally {
      running = false;
    }
  }

  function wake(): void {
    if (running) { rerun = true; return; }
    if (queued) return;
    queued = true;
    // Deferred so several wakes in the same tick start a single run.
    void Promise.resolve().then(() => { queued = false; return drain(); });
  }

  function stop(): void {
    epoch += 1;
    rerun = false;
    clearTimer();
  }

  return { wake, stop, runOnce } as const;
}
