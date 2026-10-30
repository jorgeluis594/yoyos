import { PgBoss, type JobResult, type JobWithMetadata } from "pg-boss";
import pg from "pg";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type {
  AnyEventSubscription, BlockedKeysReader, EventBusError, EventBusProvider, EventMetadata, EventName, EventPayload,
  EventSubscription, HandlerPolicy, JobScheduler, RetryPolicy, Unsubscribe,
} from "@core/src/shared/events/application/contracts";

const metadataSchema = z.strictObject({ eventId: z.uuid(), occurredAt: z.iso.datetime({ offset: false }) });
const envelopeSchema = z.strictObject({
  version: z.literal(1), name: z.string().min(1), payload: z.unknown(), metadata: metadataSchema,
});
type StoredEvent = z.infer<typeof envelopeSchema>;
type Subscription<Events extends object> = AnyEventSubscription<Events>;

const maxInt = 2_147_483_647;
const handlerIdPattern = /^[a-z][a-z0-9-]*$/;
const isInt = (value: unknown, min: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= maxInt;
const isOptionalInt = (value: unknown, min: number) => value === undefined || isInt(value, min);

function validRetryPolicy(policy: RetryPolicy): boolean {
  return isInt(policy.retries, 0) && isInt(policy.retryDelaySeconds, 0)
    && Number.isSafeInteger(policy.concurrency) && policy.concurrency >= 1
    && typeof policy.exponentialBackoff === "boolean"
    && isOptionalInt(policy.retryDelayMaxSeconds, 1) && isOptionalInt(policy.expireInSeconds, 1)
    && isOptionalInt(policy.deleteAfterSeconds, 0)
    // pg-boss rejects heartbeats under 10 s; a heartbeat at or past the expiry could never fire first.
    && isOptionalInt(policy.heartbeatSeconds, 10)
    && (policy.heartbeatSeconds === undefined || policy.expireInSeconds === undefined || policy.heartbeatSeconds < policy.expireInSeconds);
}

export function validHandlerPolicy(policy: HandlerPolicy): boolean {
  if (!validRetryPolicy(policy)) return false;
  const { orderingKey, groupKey, groupConcurrency, deadLetter } = policy;
  if (orderingKey !== undefined && (typeof orderingKey !== "function" || deadLetter === undefined)) return false;
  if (groupKey !== undefined && typeof groupKey !== "function") return false;
  if ((groupKey === undefined) !== (groupConcurrency === undefined)) return false;
  if (groupConcurrency !== undefined && !isInt(groupConcurrency, 1)) return false;
  if (deadLetter === undefined) return true;
  return typeof deadLetter.handler === "function" && handlerIdPattern.test(deadLetter.id) && validRetryPolicy(deadLetter.policy);
}

type Options<Events extends object> = {
  connectionString: string;
  subscriptions: readonly Subscription<Events>[];
  consume?: boolean;
  /** How often pg-boss fails expired and heartbeat-less attempts (supervise and monitor interval). Ten seconds keeps the chat queue's time bound (docs/event-bus.md). */
  superviseIntervalSeconds?: number;
  logger?: (entry: Record<string, unknown>) => void;
};

/** Runtime adapter. The same subscription registry prepares queues in producers and workers. */
export function createPgBossProvider<Events extends object>(options: Options<Events>) {
  const boss = new PgBoss({ connectionString: options.connectionString, schema: "pgboss",
    migrate: false, createSchema: false, reindex: false, schedule: options.consume === true,
    // Expiry and heartbeat failures run in the monitor step of a supervise pass, which waits for both intervals.
    superviseIntervalSeconds: options.superviseIntervalSeconds ?? 10, monitorIntervalSeconds: options.superviseIntervalSeconds ?? 10,
    // pg-boss sends at most one cron job per 60-second slot; a 10 s monitor keeps the job from starting up to 30 s late.
    cronMonitorIntervalSeconds: 10 });
  const pool = new pg.Pool({ connectionString: options.connectionString });
  const subscriptions = new Map<string, Subscription<Events>>();
  const consumers = new Map<string, string>();
  let started = false;
  let starting: Promise<void> | undefined;
  const log = options.logger ?? (entry => console.info(JSON.stringify(entry)));
  boss.on("error", cause => console.error("pg-boss error", cause));

  function queueOptions(policy: RetryPolicy) {
    return {
      retryLimit: policy.retries,
      retryDelay: policy.retryDelaySeconds,
      retryBackoff: policy.exponentialBackoff,
      ...(policy.retryDelayMaxSeconds === undefined ? {} : { retryDelayMax: policy.retryDelayMaxSeconds }),
      ...(policy.expireInSeconds === undefined ? {} : { expireInSeconds: policy.expireInSeconds }),
      ...(policy.heartbeatSeconds === undefined ? {} : { heartbeatSeconds: policy.heartbeatSeconds }),
      deleteAfterSeconds: policy.deleteAfterSeconds ?? 0,
    };
  }

  async function startOnce(): Promise<void> {
    subscriptions.clear();
    const queueNames = new Set<string>();
    for (const subscription of options.subscriptions) {
      const deadLetterId = subscription.policy.deadLetter?.id;
      if (!subscription.id || !handlerIdPattern.test(subscription.id)
        || queueNames.has(subscription.id) || (deadLetterId !== undefined && (deadLetterId === subscription.id || queueNames.has(deadLetterId)))
        || !validHandlerPolicy(subscription.policy)) {
        throw new Error(`Invalid event subscription: ${subscription.id}`);
      }
      queueNames.add(subscription.id);
      if (deadLetterId !== undefined) queueNames.add(deadLetterId);
      subscriptions.set(subscription.id, subscription);
    }
    await boss.start();
    try {
      for (const subscription of subscriptions.values()) {
        const { deadLetter } = subscription.policy;
        if (deadLetter) {
          const policy = queueOptions(deadLetter.policy);
          await boss.createQueue(deadLetter.id, policy);
          await boss.updateQueue(deadLetter.id, policy);
        }
        const policy = queueOptions(subscription.policy);
        // The ordering policy and the dead-letter link are fixed when the queue is created.
        await boss.createQueue(subscription.id, {
          ...policy,
          ...(subscription.policy.orderingKey ? { policy: "key_strict_fifo" as const } : {}),
          ...(deadLetter ? { deadLetter: deadLetter.id } : {}),
        });
        await boss.updateQueue(subscription.id, policy);
      }
      started = true;
    } catch (cause) {
      await boss.stop();
      throw cause;
    }
  }

  async function start(): Promise<void> {
    if (started) return;
    starting ??= startOnce();
    try { await starting; }
    finally { starting = undefined; }
  }

  async function stop(): Promise<void> {
    if (starting) await starting;
    if (started) await boss.stop({ graceful: true, timeout: 30_000 });
    started = false;
    consumers.clear();
    await pool.end();
  }

  type JobInput = { id: string; data: unknown; retryCount: number; signal: AbortSignal };
  type Run<Name extends EventName<Events>> = (
    payload: EventPayload<Events, Name>, metadata: EventMetadata, context: { signal: AbortSignal; attempt: number },
  ) => ReturnType<EventSubscription<Events, Name>["handler"]>;

  /** Validates the stored envelope, runs `run` for its company and maps the handler result to a pg-boss disposition. */
  async function settle<Name extends EventName<Events>>(
    subscription: EventSubscription<Events, Name>, queue: string, job: JobInput, run: Run<Name>,
    after?: () => Promise<void>,
  ): Promise<JobResult> {
    const begun = Date.now();
    const parsed = envelopeSchema.safeParse(job.data);
    let payload: ReturnType<typeof subscription.parsePayload> | null = null;
    if (parsed.success) {
      try { payload = subscription.parsePayload(parsed.data.payload); }
      catch (cause) { console.error("Stored event parser failed", cause); }
    }
    const company = payload?.success ? z.uuid().safeParse(payload.data.companyId) : null;
    const identity = parsed.success ? parsed.data : null;
    let status: JobResult["status"] = "deadletter";
    let message = "Invalid stored event";
    if (identity && identity.name === subscription.name && payload?.success && company?.success) {
      try {
        const result = await withTenantIsolation(company.data, () => run(
          payload.data, identity.metadata, { signal: job.signal, attempt: job.retryCount + 1 },
        ));
        if (result.success) {
          status = "completed";
          message = "completed";
        } else {
          status = result.error.retryable ? "failed" : "deadletter";
          message = result.error.message;
        }
        if (status === "completed" && after) await after();
      } catch (cause) {
        status = "failed";
        message = cause instanceof Error ? cause.message : "Unexpected handler exception";
      }
    }
    log({ eventId: identity?.metadata.eventId, event: identity?.name, handler: queue,
      companyId: company?.success ? company.data : undefined, attempt: job.retryCount + 1,
      durationMs: Date.now() - begun, result: status });
    return { id: job.id, status, output: { message } };
  }

  function execute<Name extends EventName<Events>>(subscription: EventSubscription<Events, Name>, job: JobInput) {
    return settle(subscription, subscription.id, job, subscription.handler);
  }

  /**
   * Runs the dead-letter handler, then deletes the failed source job, which releases its ordering key.
   * A failed deletion fails this job, so it retries until the key is released.
   */
  function executeDeadLetter<Name extends EventName<Events>>(
    subscription: EventSubscription<Events, Name>,
    job: JobInput & { sourceName: string | null; sourceId: string | null },
  ) {
    const { deadLetter } = subscription.policy;
    if (!deadLetter) throw new Error("Subscription has no dead-letter handler");
    return settle(subscription, deadLetter.id, job, deadLetter.handler, async () => {
      if (job.sourceName !== subscription.id || !job.sourceId) throw new Error("Dead-letter job has no matching source job");
      await boss.deleteJob(job.sourceName, job.sourceId);
    });
  }

  /** The subscription's payload was parsed by its own parser, so its policy functions accept it. */
  const erasedPolicy = (subscription: Subscription<Events>) => subscription.policy as unknown as HandlerPolicy<unknown>;
  function sendKeys(subscription: Subscription<Events>, payload: unknown): { singletonKey?: string; group?: { id: string } } | null {
    const { orderingKey, groupKey } = erasedPolicy(subscription);
    try {
      const key = orderingKey?.(payload);
      const group = groupKey?.(payload);
      if (key === "" || group === "") return null;
      return { ...(key === undefined ? {} : { singletonKey: key }), ...(group === undefined ? {} : { group: { id: group } }) };
    } catch (cause) {
      console.error("Event ordering key failed", cause);
      return null;
    }
  }

  const provider: EventBusProvider<Events> = {
    async publish<Name extends EventName<Events>>(
      name: Name, payload: EventPayload<Events, Name>, metadata: EventMetadata,
    ): Promise<Result<void, EventBusError>> {
      if (!started) return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Event bus is not ready" });
      let companyId: string;
      try { companyId = getCompanyId(); }
      catch { return err({ code: "INVALID_EVENT", message: "Company context is required" }); }
      if (!payload || typeof payload !== "object" || !("companyId" in payload)
        || !z.uuid().safeParse(companyId).success || payload.companyId !== companyId
        || !envelopeSchema.safeParse({ version: 1, name, payload, metadata }).success
        || !z.json().safeParse(payload).success) {
        return err({ code: "INVALID_EVENT", message: "Invalid event payload or metadata" });
      }
      const matching = [...subscriptions.values()].filter(subscription => subscription.name === name);
      const keys = new Map<string, ReturnType<typeof sendKeys>>();
      for (const subscription of matching) {
        try {
          const parsed = subscription.parsePayload(payload);
          if (!parsed.success) return err({ code: "INVALID_EVENT", message: "Invalid event payload" });
          const sendOptions = sendKeys(subscription, parsed.data);
          if (!sendOptions) return err({ code: "INVALID_EVENT", message: "Invalid event ordering key" });
          keys.set(subscription.id, sendOptions);
        } catch (cause) {
          console.error("Event payload parser failed", cause);
          return err({ code: "INVALID_EVENT", message: "Invalid event payload" });
        }
      }
      if (matching.length === 0) return ok(undefined);
      const envelope: StoredEvent = { version: 1, name, payload, metadata };
      const client = await pool.connect().catch(cause => {
        console.error("Job database connection failed", cause);
        return null;
      });
      if (!client) return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Job database is unavailable" });
      try {
        await client.query("BEGIN");
        for (const subscription of matching) {
          const id = await boss.send(subscription.id, envelope, {
            ...keys.get(subscription.id),
            db: { executeSql: (text, values) => client.query(text, values) },
          });
          if (!id) throw new Error("Job was not accepted");
        }
        await client.query("COMMIT");
        return ok(undefined);
      } catch (cause) {
        await client.query("ROLLBACK").catch(rollbackCause => console.error("Event bus rollback failed", rollbackCause));
        console.error("Event bus publication failed", cause);
        return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Could not persist event jobs" });
      } finally { client.release(); }
    },
    async subscribe<Name extends EventName<Events>>(
      subscription: EventSubscription<Events, Name>,
    ): Promise<Result<Unsubscribe, EventBusError>> {
      if (!started || !options.consume) return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Worker is not ready" });
      if (!Object.is(subscriptions.get(subscription.id), subscription) || consumers.has(subscription.id)) {
        return err({ code: "INVALID_SUBSCRIPTION", message: "Unknown or duplicate handler" });
      }
      try {
        const { deadLetter, groupConcurrency } = subscription.policy;
        const deadLetterId = deadLetter ? `${subscription.id}:dead-letter` : undefined;
        if (deadLetter && deadLetterId) {
          // Registered first, so a failed job can always reach its handler.
          const deadLetterWorkId = await boss.work<StoredEvent>(deadLetter.id, {
            localConcurrency: deadLetter.policy.concurrency, perJobResults: true, includeMetadata: true,
          }, async jobs => Promise.all((jobs as JobWithMetadata<StoredEvent>[]).map(job => executeDeadLetter(subscription, job))));
          consumers.set(deadLetterId, deadLetterWorkId);
        }
        const workId = await boss.work<StoredEvent>(subscription.id, {
          localConcurrency: subscription.policy.concurrency, perJobResults: true,
          // pg-boss's server-side groupConcurrency is checked by each poller before it claims, so the pollers of one
          // worker race past the limit (verified in the ordering integration test). The in-process limit is exact.
          ...(groupConcurrency === undefined ? {} : { localGroupConcurrency: groupConcurrency }),
        }, async jobs => Promise.all(jobs.map(job => execute(subscription, job))));
        consumers.set(subscription.id, workId);
        return ok(async () => {
          if (consumers.get(subscription.id) === workId) {
            try {
              await boss.offWork(subscription.id, { id: workId, wait: false });
              consumers.delete(subscription.id);
              const deadLetterWorkId = deadLetterId ? consumers.get(deadLetterId) : undefined;
              if (deadLetter && deadLetterId && deadLetterWorkId) {
                await boss.offWork(deadLetter.id, { id: deadLetterWorkId, wait: false });
                consumers.delete(deadLetterId);
              }
            } catch (cause) {
              console.error("Event bus cleanup failed", cause);
              return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Could not stop event handler" });
            }
          }
          return ok(undefined);
        });
      } catch (cause) {
        console.error("Event bus subscription failed", cause);
        return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Could not start event handler" });
      }
    },
  };
  const blockedKeys: BlockedKeysReader = {
    async listBlockedKeys(handlerId) {
      if (!started) return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Event bus is not ready" });
      try {
        if (!await boss.getQueue(handlerId)) return ok([]);
        return ok(await boss.getBlockedKeys(handlerId));
      } catch (cause) {
        console.error("Blocked keys lookup failed", cause);
        return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Could not read blocked keys" });
      }
    },
  };
  const scheduler: JobScheduler = {
    /** Worker only: pg-boss sends the cron job, and a missed run (worker down at that time) is sent once on restart. */
    async schedule(name, cron, handler, { tz, policy: jobPolicy }) {
      if (!started || !options.consume) return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Worker is not ready" });
      if (!/^[a-z][a-z0-9-]*$/.test(name) || subscriptions.has(name) || consumers.has(name)) {
        return err({ code: "INVALID_SUBSCRIPTION", message: "Unknown or duplicate scheduled job" });
      }
      try {
        const policy = jobPolicy
          ? { retryLimit: jobPolicy.retryLimit, retryDelay: 0, retryBackoff: false, expireInSeconds: jobPolicy.expireInSeconds }
          : { retryLimit: 3, retryDelay: 300, retryBackoff: false };
        // The queue policy is fixed when the queue is created.
        await boss.createQueue(name, { ...policy, ...(jobPolicy && jobPolicy.queuePolicy !== "standard" ? { policy: jobPolicy.queuePolicy } : {}) });
        await boss.updateQueue(name, policy);
        await boss.schedule(name, cron, null, { tz, missed: "once" });
        // A job with its own policy is latency-bound (the stock recovery): without this, an idle worker relies on NOTIFY with a 30 s backstop poll and starts a fresh cron job up to 30 s late.
        const pollEvery = jobPolicy ? { pollingIntervalSeconds: 2, notifyPollingIntervalSeconds: 2 } : {};
        const workId = await boss.work(name, pollEvery, async jobs => {
          for (const job of jobs) {
            const result = await handler({ signal: job.signal, attempt: job.retryCount + 1 });
            if (!result.success) throw new Error(result.error.message);
          }
        });
        consumers.set(name, workId);
        return ok(async () => {
          if (consumers.get(name) !== workId) return ok(undefined);
          try {
            await boss.offWork(name, { id: workId, wait: false });
            consumers.delete(name);
            return ok(undefined);
          } catch (cause) {
            console.error("Scheduled job cleanup failed", cause);
            return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Could not stop scheduled job" });
          }
        });
      } catch (cause) {
        console.error("Scheduled job registration failed", cause);
        return err({ code: "EVENT_BUS_UNAVAILABLE", message: "Could not schedule job" });
      }
    },
  };
  return { ...provider, ...scheduler, ...blockedKeys, start, stop };
}
