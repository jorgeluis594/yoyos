import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { EventSubscription } from "@core/src/shared/events/application/contracts";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";

type Events = { "test.completed": { value: string }; "test.unhandled": { value: string } };
const payloadSchema = z.object({ companyId: z.uuid(), value: z.string() });
const parsePayload = (input: unknown) => {
  const parsed = payloadSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_EVENT" as const, message: "Invalid test payload" });
};

describe("pg-boss event delivery", () => {
  it("persists fan-out while workers are offline and settles each handler independently", async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    const suffix = randomUUID().slice(0, 8);
    const companyId = randomUUID();
    const eventId = randomUUID();
    const calls: string[] = [];
    const successfulHandler = vi.fn(async () => { calls.push(getCompanyId()); return ok(undefined); });
    const failingHandler = vi.fn(async () => { calls.push(getCompanyId()); return err({ code: "FAILED", message: "failed", retryable: false }); });
    const subscriptions: EventSubscription<Events, "test.completed">[] = ["first", "second"].map(label => ({
      id: `event-test-${label}-${suffix}`, name: "test.completed",
      handler: label === "first" ? failingHandler : successfulHandler, parsePayload,
      policy: { retries: 0, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 1 },
    }));
    const producer = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions });
    const worker = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions, consume: true });
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const names = subscriptions.map(subscription => subscription.id);
    try {
      await producer.start();
      const metadata = { eventId, occurredAt: "2026-09-30T12:00:00.000Z" };
      const published = await withTenantIsolation(companyId, () => producer.publish(
        "test.completed", { companyId, value: "saved" }, metadata,
      ));
      expect(published).toEqual(ok(undefined));
      const stored = await pool.query<{ name: string; data: { metadata: { eventId: string } } }>(
        "SELECT name, data FROM pgboss.job WHERE name = ANY($1) ORDER BY name", [names],
      );
      expect(stored.rows.map(row => row.name)).toEqual(names);
      expect(stored.rows.map(row => row.data.metadata.eventId)).toEqual([eventId, eventId]);
      expect(successfulHandler).not.toHaveBeenCalled();

      await worker.start();
      for (const subscription of subscriptions) expect((await worker.subscribe(subscription)).success).toBe(true);
      await vi.waitFor(() => expect(calls).toEqual([companyId, companyId]), { timeout: 15_000, interval: 100 });
      expect(successfulHandler).toHaveBeenCalledWith({ companyId, value: "saved" }, metadata,
        expect.objectContaining({ attempt: 1, signal: expect.any(AbortSignal) }));
      await vi.waitFor(async () => {
        const outcomes = await pool.query<{ name: string; state: string }>(
          "SELECT name, state FROM pgboss.job WHERE name = ANY($1) ORDER BY name", [names],
        );
        expect(outcomes.rows).toEqual([{ name: names[0], state: "failed" }, { name: names[1], state: "completed" }]);
      }, { timeout: 15_000 });
    } finally {
      await worker.stop();
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = ANY($1)", [names]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = ANY($1)", [names]);
      await pool.end();
    }
  });

  it("rolls back all jobs when a later queue cannot accept its job", async () => {
    const suffix = randomUUID().slice(0, 8);
    const companyId = randomUUID();
    const subscriptions: EventSubscription<Events, "test.completed">[] = ["first", "second"].map(label => ({
      id: `event-rollback-${label}-${suffix}`, name: "test.completed", parsePayload,
      handler: async () => ok(undefined),
      policy: { retries: 0, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 1 },
    }));
    const names = subscriptions.map(subscription => subscription.id);
    const producer = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions });
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await producer.start();
      expect(await producer.publish("test.completed", { companyId, value: "missing context" },
        { eventId: randomUUID(), occurredAt: "2026-09-30T12:00:00.000Z" })).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
      expect(await withTenantIsolation(companyId, () => producer.publish("test.completed", { companyId: randomUUID(), value: "wrong company" },
        { eventId: randomUUID(), occurredAt: "2026-09-30T12:00:00.000Z" }))).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
      expect(await withTenantIsolation(companyId, () => producer.publish("test.completed", { companyId, value: 1 } as unknown as { companyId: string; value: string },
        { eventId: randomUUID(), occurredAt: "2026-09-30T12:00:00.000Z" }))).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
      expect(await withTenantIsolation(companyId, () => producer.publish("test.unhandled", { companyId, value: "no consumers" },
        { eventId: randomUUID(), occurredAt: "2026-09-30T12:00:00.000Z" }))).toEqual(ok(undefined));
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [names[1]]);
      const published = await withTenantIsolation(companyId, () => producer.publish(
        "test.completed", { companyId, value: "rollback" },
        { eventId: randomUUID(), occurredAt: "2026-09-30T12:00:00.000Z" },
      ));
      expect(published).toMatchObject({ success: false, error: { code: "EVENT_BUS_UNAVAILABLE" } });
      expect((await pool.query("SELECT id FROM pgboss.job WHERE name = $1", [names[0]])).rowCount).toBe(0);
    } finally {
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = ANY($1)", [names]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = ANY($1)", [names]);
      await pool.end();
    }
  });

  it("retries only retryable failures and permanently fails invalid stored data", async () => {
    const name = `event-failures-${randomUUID().slice(0, 8)}`;
    const companyId = randomUUID();
    const attempts: number[] = [];
    const subscription: EventSubscription<Events, "test.completed"> = {
      id: name, name: "test.completed", parsePayload,
      policy: { retries: 1, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 1 },
      handler: async (payload, _metadata, context) => {
        attempts.push(context.attempt);
        if (payload.value === "permanent") return err({ code: "PERMANENT", message: "permanent", retryable: false });
        if (payload.value === "exception" && context.attempt === 1) throw new Error("unexpected");
        return context.attempt === 1
          ? err({ code: "TEMPORARY", message: "temporary", retryable: true })
          : ok(undefined);
      },
    };
    const producer = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions: [subscription] });
    const worker = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions: [subscription], consume: true });
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const state = async (eventId: string) => (await pool.query<{ state: string; retry_count: number }>(
      "SELECT state, retry_count FROM pgboss.job WHERE name = $1 AND data->'metadata'->>'eventId' = $2", [name, eventId],
    )).rows[0];
    try {
      await producer.start();
      await worker.start();
      expect((await worker.subscribe(subscription)).success).toBe(true);
      const retryId = randomUUID();
      expect(await withTenantIsolation(companyId, () => producer.publish("test.completed", { companyId, value: "retry" },
        { eventId: retryId, occurredAt: "2026-09-30T12:00:00.000Z" }))).toEqual(ok(undefined));
      await vi.waitFor(async () => expect(await state(retryId)).toMatchObject({ state: "completed", retry_count: 1 }), { timeout: 15_000 });
      expect(attempts).toEqual([1, 2]);

      const permanentId = randomUUID();
      expect(await withTenantIsolation(companyId, () => producer.publish("test.completed", { companyId, value: "permanent" },
        { eventId: permanentId, occurredAt: "2026-09-30T12:00:00.000Z" }))).toEqual(ok(undefined));
      await vi.waitFor(async () => expect(await state(permanentId)).toMatchObject({ state: "failed", retry_count: 0 }), { timeout: 15_000 });

      const exceptionId = randomUUID();
      expect(await withTenantIsolation(companyId, () => producer.publish("test.completed", { companyId, value: "exception" },
        { eventId: exceptionId, occurredAt: "2026-09-30T12:00:00.000Z" }))).toEqual(ok(undefined));
      await vi.waitFor(async () => expect(await state(exceptionId)).toMatchObject({ state: "completed", retry_count: 1 }), { timeout: 15_000 });

      await pool.query("INSERT INTO pgboss.job (name, data) VALUES ($1, $2)", [name, { version: 1, name: "test.completed", payload: { companyId: "bad" }, metadata: { eventId: randomUUID() } }]);
      await vi.waitFor(async () => expect((await pool.query(
        "SELECT state FROM pgboss.job WHERE name = $1 AND data->'payload'->>'companyId' = 'bad'", [name],
      )).rows[0]?.state).toBe("failed"), { timeout: 15_000 });
      expect(attempts).toEqual([1, 2, 1, 1, 2]);
    } finally {
      await worker.stop();
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = $1", [name]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [name]);
      await pool.end();
    }
  });

  it("isolates concurrent tenants and leaves jobs pending after local cleanup", async () => {
    const name = `event-isolation-${randomUUID().slice(0, 8)}`;
    const companies = [randomUUID(), randomUUID()];
    const seen: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const subscription: EventSubscription<Events, "test.completed"> = {
      id: name, name: "test.completed", parsePayload,
      policy: { retries: 0, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 2 },
      handler: async () => {
        started += 1;
        if (started === 2) release();
        await bothStarted;
        seen.push(getCompanyId());
        return ok(undefined);
      },
    };
    const producer = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions: [subscription] });
    const worker = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions: [subscription], consume: true });
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await producer.start();
      await worker.start();
      const registered = await worker.subscribe(subscription);
      expect(registered.success).toBe(true);
      for (const companyId of companies) {
        expect(await withTenantIsolation(companyId, () => producer.publish("test.completed", { companyId, value: "concurrent" },
          { eventId: randomUUID(), occurredAt: "2026-09-30T12:00:00.000Z" }))).toEqual(ok(undefined));
      }
      await vi.waitFor(() => expect(seen.slice().sort()).toEqual(companies.slice().sort()), { timeout: 15_000 });
      if (registered.success) expect(await registered.data()).toEqual(ok(undefined));
      const pendingId = randomUUID();
      expect(await withTenantIsolation(companies[0], () => producer.publish("test.completed", { companyId: companies[0], value: "pending" },
        { eventId: pendingId, occurredAt: "2026-09-30T12:00:00.000Z" }))).toEqual(ok(undefined));
      expect((await pool.query("SELECT state FROM pgboss.job WHERE name = $1 AND data->'metadata'->>'eventId' = $2", [name, pendingId])).rows[0]?.state).toBe("created");
      expect(seen).toHaveLength(2);
    } finally {
      release();
      await worker.stop();
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = $1", [name]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [name]);
      await pool.end();
    }
  });

  it("recovers an expired attempt without repeating an idempotent database effect", async () => {
    const suffix = randomUUID().slice(0, 8);
    const name = `event-recovery-${suffix}`;
    const effectTable = `event_effect_${suffix}`;
    const companyId = randomUUID();
    const eventId = randomUUID();
    const appUrl = process.env.DATABASE_URL!;
    const adminUrl = new URL(appUrl);
    adminUrl.username = "core";
    adminUrl.password = "core";
    const admin = new pg.Pool({ connectionString: adminUrl.toString() });
    const pool = new pg.Pool({ connectionString: appUrl });
    const attempts: number[] = [];
    const subscription: EventSubscription<Events, "test.completed"> = {
      id: name, name: "test.completed", parsePayload,
      policy: { retries: 1, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 1 },
      handler: async (_payload, metadata, context) => {
        expect(getCompanyId()).toBe(companyId);
        attempts.push(context.attempt);
        await pool.query(`INSERT INTO public.${effectTable} (event_id) VALUES ($1) ON CONFLICT DO NOTHING`, [metadata.eventId]);
        return ok(undefined);
      },
    };
    const producer = createPgBossProvider<Events>({ connectionString: appUrl, subscriptions: [subscription] });
    const worker = createPgBossProvider<Events>({ connectionString: appUrl, subscriptions: [subscription], consume: true });
    const supervisor = new PgBoss({ connectionString: appUrl, schema: "pgboss", migrate: false, createSchema: false,
      supervise: false, persistQueueStats: false, reindex: false });
    try {
      await admin.query(`CREATE TABLE public.${effectTable} (event_id uuid PRIMARY KEY)`);
      await admin.query(`GRANT INSERT, SELECT ON public.${effectTable} TO core_app`);
      await admin.query(`INSERT INTO public.${effectTable} (event_id) VALUES ($1)`, [eventId]);
      await producer.start();
      await pool.query(
        "INSERT INTO pgboss.job (name, data, state, retry_limit, expire_seconds, started_on) VALUES ($1, $2, 'active', 1, 1, now() - interval '5 minutes')",
        [name, { version: 1, name: "test.completed", payload: { companyId, value: "recover" },
          metadata: { eventId, occurredAt: "2026-09-30T12:00:00.000Z" } }],
      );
      await supervisor.start();
      await supervisor.supervise(name);
      expect((await pool.query("SELECT state FROM pgboss.job WHERE name = $1", [name])).rows[0]?.state).toBe("retry");
      await worker.start();
      expect((await worker.subscribe(subscription)).success).toBe(true);
      await vi.waitFor(async () => expect((await pool.query("SELECT state FROM pgboss.job WHERE name = $1", [name])).rows[0]?.state).toBe("completed"), { timeout: 15_000 });
      expect(attempts).toEqual([2]);
      expect((await admin.query(`SELECT count(*)::int AS count FROM public.${effectTable}`)).rows[0]?.count).toBe(1);
    } finally {
      await supervisor.stop();
      await worker.stop();
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = $1", [name]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [name]);
      await pool.end();
      await admin.query(`DROP TABLE IF EXISTS public.${effectTable}`);
      await admin.end();
    }
  });
});
