import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { expect, it, vi } from "vitest";
import { ok } from "@shared/functional";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";
import { stockDeductionRecoveryPolicy } from "@core/src/composition/scheduled-jobs";

const connectionString = process.env.DATABASE_URL!;
const worker = () => createPgBossProvider<Record<string, never>>({ connectionString, subscriptions: [], consume: true });

async function cleanup(pool: pg.Pool, name: string) {
  await pool.query("DELETE FROM pgboss.schedule WHERE name = $1", [name]);
  await pool.query("DELETE FROM pgboss.job WHERE name = $1", [name]);
  await pool.query("DELETE FROM pgboss.queue WHERE name = $1", [name]);
  await pool.end();
}

it("creates the recovery queue as stately with no retry and a 58 s expiry", async () => {
  const name = `recovery-policy-${randomUUID().slice(0, 8)}`;
  const provider = worker();
  const pool = new pg.Pool({ connectionString });
  try {
    await provider.start();
    expect((await provider.schedule(name, "* * * * *", async () => ok(undefined), { tz: "America/Lima", policy: stockDeductionRecoveryPolicy })).success).toBe(true);
    const queue = await pool.query("SELECT policy, retry_limit, expire_seconds FROM pgboss.queue WHERE name = $1", [name]);
    expect(queue.rows).toEqual([{ policy: "stately", retry_limit: 0, expire_seconds: 58 }]);
  } finally {
    await provider.stop();
    await cleanup(pool, name);
  }
});

it("the recovery job never runs twice at once across two workers", async () => {
  const name = `recovery-single-${randomUUID().slice(0, 8)}`;
  const first = worker();
  const second = worker();
  const sender = new PgBoss({ connectionString, schema: "pgboss", migrate: false, createSchema: false, reindex: false, schedule: false, supervise: false });
  const pool = new pg.Pool({ connectionString });
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handler = vi.fn(async () => { runs += 1; active += 1; maxActive = Math.max(maxActive, active); await gate; active -= 1; return ok(undefined); });
  try {
    await Promise.all([first.start(), second.start(), sender.start()]);
    await first.schedule(name, "* * * * *", handler, { tz: "America/Lima", policy: stockDeductionRecoveryPolicy });
    await second.schedule(name, "* * * * *", handler, { tz: "America/Lima", policy: stockDeductionRecoveryPolicy });
    // Several sends while one run is active: stately keeps one active and one queued.
    await sender.send(name, null);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 15_000, interval: 100 });
    const extra = await Promise.all([sender.send(name, null), sender.send(name, null), sender.send(name, null)]);
    expect(extra.filter((id) => id !== null).length).toBeLessThanOrEqual(1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(maxActive).toBe(1);
    release();
    await vi.waitFor(() => expect(active).toBe(0), { timeout: 15_000, interval: 100 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(maxActive).toBe(1);
    expect(runs).toBeLessThanOrEqual(2);
  } finally {
    release();
    await sender.stop({ graceful: false });
    await first.stop();
    await second.stop();
    await cleanup(pool, name);
  }
}, 60_000);

it("the recovery schedule survives a worker restart", async () => {
  const name = `recovery-restart-${randomUUID().slice(0, 8)}`;
  const before = worker();
  const after = worker();
  const sender = new PgBoss({ connectionString, schema: "pgboss", migrate: false, createSchema: false, reindex: false, schedule: false, supervise: false });
  const pool = new pg.Pool({ connectionString });
  const handler = vi.fn(async () => ok(undefined));
  try {
    await Promise.all([before.start(), sender.start()]);
    await before.schedule(name, "* * * * *", async () => ok(undefined), { tz: "America/Lima", policy: stockDeductionRecoveryPolicy });
    await before.stop();
    // The schedule row outlives the worker, and a job sent while no worker runs waits for the next one.
    expect((await pool.query("SELECT cron FROM pgboss.schedule WHERE name = $1", [name])).rows).toEqual([{ cron: "* * * * *" }]);
    await sender.send(name, null);
    await after.start();
    await after.schedule(name, "* * * * *", handler, { tz: "America/Lima", policy: stockDeductionRecoveryPolicy });
    await vi.waitFor(() => expect(handler).toHaveBeenCalled(), { timeout: 20_000, interval: 100 });
    expect((await pool.query("SELECT count(*)::int AS count FROM pgboss.schedule WHERE name = $1", [name])).rows).toEqual([{ count: 1 }]);
  } finally {
    await sender.stop({ graceful: false });
    await after.stop();
    await cleanup(pool, name);
  }
}, 60_000);
