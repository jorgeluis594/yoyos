import { PgBoss, type JobResult } from "pg-boss";
import pg from "pg";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type {
  AnyEventSubscription, EventBusError, EventBusProvider, EventMetadata, EventName, EventPayload,
  EventSubscription, HandlerPolicy, Unsubscribe,
} from "@core/src/shared/events/application/contracts";

const metadataSchema = z.strictObject({ eventId: z.uuid(), occurredAt: z.iso.datetime({ offset: false }) });
const envelopeSchema = z.strictObject({
  version: z.literal(1), name: z.string().min(1), payload: z.unknown(), metadata: metadataSchema,
});
type StoredEvent = z.infer<typeof envelopeSchema>;
type Subscription<Events extends object> = AnyEventSubscription<Events>;

export function validHandlerPolicy(policy: HandlerPolicy): boolean {
  return Number.isInteger(policy.retries) && policy.retries >= 0 && policy.retries <= 2_147_483_647
    && Number.isInteger(policy.retryDelaySeconds) && policy.retryDelaySeconds >= 0 && policy.retryDelaySeconds <= 2_147_483_647
    && Number.isSafeInteger(policy.concurrency) && policy.concurrency >= 1
    && typeof policy.exponentialBackoff === "boolean";
}

type Options<Events extends object> = {
  connectionString: string;
  subscriptions: readonly Subscription<Events>[];
  consume?: boolean;
  logger?: (entry: Record<string, unknown>) => void;
};

/** Runtime adapter. The same subscription registry prepares queues in producers and workers. */
export function createPgBossProvider<Events extends object>(options: Options<Events>) {
  const boss = new PgBoss({ connectionString: options.connectionString, schema: "pgboss", migrate: false, createSchema: false });
  const pool = new pg.Pool({ connectionString: options.connectionString });
  const subscriptions = new Map<string, Subscription<Events>>();
  const consumers = new Map<string, string>();
  let started = false;
  let starting: Promise<void> | undefined;
  const log = options.logger ?? (entry => console.info(JSON.stringify(entry)));
  boss.on("error", cause => console.error("pg-boss error", cause));

  async function startOnce(): Promise<void> {
    subscriptions.clear();
    for (const subscription of options.subscriptions) {
      if (!subscription.id || !/^[a-z][a-z0-9-]*$/.test(subscription.id)
        || subscriptions.has(subscription.id) || !validHandlerPolicy(subscription.policy)) {
        throw new Error(`Invalid event subscription: ${subscription.id}`);
      }
      subscriptions.set(subscription.id, subscription);
    }
    await boss.start();
    try {
      for (const subscription of subscriptions.values()) {
        const policy = {
          retryLimit: subscription.policy.retries,
          retryDelay: subscription.policy.retryDelaySeconds,
          retryBackoff: subscription.policy.exponentialBackoff,
          deleteAfterSeconds: 0,
        };
        await boss.createQueue(subscription.id, policy);
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

  async function execute<Name extends EventName<Events>>(
    subscription: EventSubscription<Events, Name>,
    job: { id: string; data: unknown; retryCount: number; signal: AbortSignal },
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
        const result = await withTenantIsolation(company.data, () => subscription.handler(
          payload.data, identity.metadata, { signal: job.signal, attempt: job.retryCount + 1 },
        ));
        if (result.success) {
          status = "completed";
          message = "completed";
        } else {
          status = result.error.retryable ? "failed" : "deadletter";
          message = result.error.message;
        }
      } catch (cause) {
        status = "failed";
        message = cause instanceof Error ? cause.message : "Unexpected handler exception";
      }
    }
    log({ eventId: identity?.metadata.eventId, event: identity?.name, handler: subscription.id,
      companyId: company?.success ? company.data : undefined, attempt: job.retryCount + 1,
      durationMs: Date.now() - begun, result: status });
    return { id: job.id, status, output: { message } };
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
      for (const subscription of matching) {
        try {
          if (!subscription.parsePayload(payload).success) {
            return err({ code: "INVALID_EVENT", message: "Invalid event payload" });
          }
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
        const workId = await boss.work<StoredEvent>(subscription.id, {
          localConcurrency: subscription.policy.concurrency, perJobResults: true,
        }, async jobs => Promise.all(jobs.map(job => execute(subscription, job))));
        consumers.set(subscription.id, workId);
        return ok(async () => {
          if (consumers.get(subscription.id) === workId) {
            try {
              await boss.offWork(subscription.id, { id: workId, wait: false });
              consumers.delete(subscription.id);
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
  return { ...provider, start, stop };
}
