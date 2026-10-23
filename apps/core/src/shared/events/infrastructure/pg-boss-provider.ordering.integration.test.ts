import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { EventHandler, EventSubscription, HandlerPolicy } from "@core/src/shared/events/application/contracts";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";

type Payload = { companyId: string; chatId: string; value: string };
type Events = { "test.ordered": { chatId: string; value: string } };
const payloadSchema = z.object({ companyId: z.uuid(), chatId: z.string(), value: z.string() });
const parsePayload = (input: unknown) => {
  const parsed = payloadSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_EVENT" as const, message: "Invalid test payload" });
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const connectionString = () => process.env.DATABASE_URL!;

type Harness = Awaited<ReturnType<typeof harness>>;
async function harness(options: {
  handler: EventHandler<Events, "test.ordered">;
  deadLetter?: EventHandler<Events, "test.ordered">;
  policy?: Partial<HandlerPolicy<Payload>>;
  deadLetterPolicy?: Partial<HandlerPolicy>;
}) {
  const suffix = randomUUID().slice(0, 8);
  const id = `ordered-${suffix}`;
  const deadLetterId = `ordered-dlq-${suffix}`;
  const subscription: EventSubscription<Events, "test.ordered"> = {
    id, name: "test.ordered", parsePayload, handler: options.handler,
    policy: { retries: 0, retryDelaySeconds: 1, exponentialBackoff: false, concurrency: 4,
      orderingKey: payload => payload.chatId,
      deadLetter: { id: deadLetterId, handler: options.deadLetter ?? (async () => ok(undefined)),
        policy: { retries: 1, retryDelaySeconds: 1, exponentialBackoff: false, concurrency: 2, ...options.deadLetterPolicy } },
      ...options.policy },
  };
  const worker = createPgBossProvider<Events>({ connectionString: connectionString(), subscriptions: [subscription],
    consume: true, superviseIntervalSeconds: 1 });
  const producer = createPgBossProvider<Events>({ connectionString: connectionString(), subscriptions: [subscription] });
  const pool = new pg.Pool({ connectionString: connectionString() });
  const companyId = randomUUID();
  await producer.start();
  await worker.start();
  const unsubscribe = await worker.subscribe(subscription);
  expect(unsubscribe.success).toBe(true);
  return {
    id, deadLetterId, worker, pool, companyId,
    async publish(chatId: string, value: string, company = companyId) {
      const published = await withTenantIsolation(company, () => producer.publish("test.ordered",
        { companyId: company, chatId, value }, { eventId: randomUUID(), occurredAt: "2026-10-22T12:00:00.000Z" }));
      expect(published).toEqual(ok(undefined));
    },
    async states() {
      const rows = await pool.query<{ name: string; state: string; singleton_key: string | null }>(
        "SELECT name, state, singleton_key FROM pgboss.job WHERE name = ANY($1) ORDER BY created_on", [[id, deadLetterId]]);
      return rows.rows;
    },
    async close() {
      await worker.stop();
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = ANY($1)", [[id, deadLetterId]]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [id]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [deadLetterId]);
      await pool.end();
    },
  };
}
async function using(h: Harness, run: () => Promise<void>) {
  try { await run(); } finally { await h.close(); }
}
const wait = { timeout: 30_000, interval: 100 };

describe("ordered event queues", () => {
  it("runs the jobs of one ordering key one at a time in publication order", async () => {
    const events: string[] = [];
    let running = 0;
    let overlapped = false;
    const h = await harness({ handler: async payload => {
      running += 1;
      if (running > 1) overlapped = true;
      events.push(`start-${payload.value}`);
      await sleep(300);
      events.push(`end-${payload.value}`);
      running -= 1;
      return ok(undefined);
    } });
    await using(h, async () => {
      await h.publish("c1", "first");
      await h.publish("c1", "second");
      await h.publish("c1", "third");
      await vi.waitFor(() => expect(events).toHaveLength(6), wait);
      expect(events).toEqual(["start-first", "end-first", "start-second", "end-second", "start-third", "end-third"]);
      expect(overlapped).toBe(false);
    });
  });

  it("holds the key of a retrying job while another key keeps running", async () => {
    const events: string[] = [];
    const h = await harness({ policy: { retries: 1, retryDelaySeconds: 3 }, handler: async (payload, _metadata, context) => {
      events.push(`${payload.chatId}-${payload.value}-${context.attempt}`);
      if (payload.value === "first" && context.attempt === 1) return err({ code: "TEMPORARY", message: "retry", retryable: true });
      return ok(undefined);
    } });
    await using(h, async () => {
      await h.publish("c1", "first");
      await h.publish("c1", "second");
      await sleep(500);
      await h.publish("c2", "other");
      await vi.waitFor(() => expect(events).toHaveLength(4), wait);
      expect(events[0]).toBe("c1-first-1");
      expect(events.indexOf("c2-other-1")).toBeLessThan(events.indexOf("c1-first-2"));
      expect(events.slice(-2)).toEqual(["c1-first-2", "c1-second-1"]);
    });
  });

  it("a job that exhausts its retries is released by the dead-letter handler and the next message of its chat runs", async () => {
    const seen: string[] = [];
    const deadLettered: Payload[] = [];
    const h = await harness({
      policy: { retries: 1, retryDelaySeconds: 1 },
      handler: async payload => {
        seen.push(payload.value);
        return payload.value === "bad" ? err({ code: "TEMPORARY", message: "down", retryable: true }) : ok(undefined);
      },
      deadLetter: async payload => { deadLettered.push(payload); return ok(undefined); },
    });
    await using(h, async () => {
      await h.publish("c1", "bad");
      await h.publish("c1", "good");
      await vi.waitFor(() => expect(seen).toEqual(["bad", "bad", "good"]), wait);
      expect(deadLettered).toEqual([expect.objectContaining({ chatId: "c1", value: "bad" })]);
      await vi.waitFor(async () => {
        const rows = await h.states();
        expect(rows.filter(row => row.name === h.id).map(row => row.state)).toEqual(["completed"]);
      }, wait);
    });
  });

  it("a job whose last attempt expires is recorded as failed and releases its chat", async () => {
    const dead: string[] = [];
    const seen: string[] = [];
    const h = await harness({
      policy: { expireInSeconds: 2 },
      handler: async (payload, _metadata, context) => {
        seen.push(payload.value);
        if (payload.value === "hang") await new Promise(resolve => context.signal.addEventListener("abort", resolve, { once: true }));
        return payload.value === "hang" ? err({ code: "ABORTED", message: "aborted", retryable: true }) : ok(undefined);
      },
      deadLetter: async payload => { dead.push(payload.value); return ok(undefined); },
    });
    await using(h, async () => {
      await h.publish("c1", "hang");
      await h.publish("c1", "next");
      await vi.waitFor(() => expect(dead).toEqual(["hang"]), wait);
      await vi.waitFor(() => expect(seen).toEqual(["hang", "next"]), wait);
    });
  });

  it("fails the dead-letter job and retries it when the source job cannot be deleted", async () => {
    const attempts: number[] = [];
    const h = await harness({
      policy: { retries: 0 },
      deadLetterPolicy: { retries: 2, retryDelaySeconds: 1 },
      handler: async () => err({ code: "TEMPORARY", message: "down", retryable: true }),
      deadLetter: async (_payload, _metadata, context) => {
        attempts.push(context.attempt);
        if (context.attempt === 1) return err({ code: "DB_DOWN", message: "cannot write", retryable: true });
        return ok(undefined);
      },
    });
    await using(h, async () => {
      await h.publish("c1", "bad");
      await vi.waitFor(() => expect(attempts).toEqual([1, 2]), wait);
      await vi.waitFor(async () => expect((await h.states()).filter(row => row.name === h.id)).toEqual([]), wait);
    });
  });

  it("one company's burst never takes more than its group concurrency", async () => {
    let running = 0;
    let peak = 0;
    let done = 0;
    const h = await harness({
      policy: { concurrency: 6, groupKey: payload => payload.companyId, groupConcurrency: 2 },
      handler: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await sleep(400);
        running -= 1;
        done += 1;
        return ok(undefined);
      },
    });
    await using(h, async () => {
      for (let index = 0; index < 6; index += 1) await h.publish(`chat-${index}`, String(index));
      await vi.waitFor(() => expect(done).toBe(6), wait);
      expect(peak).toBe(2);
    });
  });

  it("never runs two jobs of one group at once with a group concurrency of one", async () => {
    let running = 0;
    let peak = 0;
    let done = 0;
    const h = await harness({
      policy: { concurrency: 4, groupKey: payload => payload.companyId, groupConcurrency: 1 },
      handler: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await sleep(300);
        running -= 1;
        done += 1;
        return ok(undefined);
      },
    });
    await using(h, async () => {
      for (let index = 0; index < 3; index += 1) await h.publish(`chat-${index}`, String(index));
      await vi.waitFor(() => expect(done).toBe(3), wait);
      expect(peak).toBe(1);
    });
  });

  it("the blocked-keys check reports a chat held by a failed job", async () => {
    const h = await harness({
      policy: { retries: 0 },
      deadLetterPolicy: { retries: 0 },
      handler: async () => err({ code: "TEMPORARY", message: "down", retryable: true }),
      deadLetter: async () => err({ code: "DB_DOWN", message: "cannot write", retryable: true }),
    });
    await using(h, async () => {
      expect(await h.worker.listBlockedKeys(h.id)).toEqual(ok([]));
      await h.publish("c1", "bad");
      await vi.waitFor(async () => expect(await h.worker.listBlockedKeys(h.id)).toEqual(ok(["c1"])), wait);
    });
  });

  it("the blocked-keys check treats a queue that does not exist yet as having none", async () => {
    const h = await harness({ handler: async () => ok(undefined) });
    await using(h, async () => {
      expect(await h.worker.listBlockedKeys(`missing-${randomUUID().slice(0, 8)}`)).toEqual(ok([]));
    });
  });

  it("fails a crashed attempt as a retry through its heartbeat", async () => {
    const name = `heartbeat-${randomUUID().slice(0, 8)}`;
    const pool = new pg.Pool({ connectionString: connectionString() });
    const boss = new PgBoss({ connectionString: connectionString(), schema: "pgboss", migrate: false, createSchema: false,
      superviseIntervalSeconds: 1, monitorIntervalSeconds: 1, schedule: false });
    await boss.start();
    try {
      await boss.createQueue(name, { policy: "key_strict_fifo", heartbeatSeconds: 10, expireInSeconds: 120, retryLimit: 1, retryDelay: 1 });
      await boss.send(name, { value: "crash" }, { singletonKey: "c1" });
      expect(await boss.fetch(name)).toHaveLength(1);
      // pg-boss counts the retry when the job is fetched again, so a failed heartbeat shows as `retry` with the old count.
      await vi.waitFor(async () => {
        const rows = await pool.query("SELECT state, retry_count FROM pgboss.job WHERE name = $1", [name]);
        expect(rows.rows).toEqual([{ state: "retry", retry_count: 0 }]);
      }, { timeout: 40_000, interval: 500 });
    } finally {
      await boss.stop({ graceful: false });
      await pool.query("DELETE FROM pgboss.job WHERE name = $1", [name]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [name]);
      await pool.end();
    }
  }, 60_000);
});
