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

it("creates the recovery queue with no retry and a 58 s expiry", async () => {
  const name = `recovery-policy-${randomUUID().slice(0, 8)}`;
  const provider = worker();
  const pool = new pg.Pool({ connectionString });
  try {
    await provider.start();
    expect((await provider.schedule(name, "* * * * *", async () => ok(undefined), { tz: "America/Lima", policy: stockDeductionRecoveryPolicy })).success).toBe(true);
    const queue = await pool.query("SELECT policy, retry_limit, expire_seconds FROM pgboss.queue WHERE name = $1", [name]);
    expect(queue.rows).toEqual([{ policy: "standard", retry_limit: 0, expire_seconds: 58 }]);
  } finally {
    await provider.stop();
    await cleanup(pool, name);
  }
});

it("the recovery job starts within seconds when it is created after a long run", async () => {
  const name = `recovery-latency-${randomUUID().slice(0, 8)}`;
  const provider = worker();
  const sender = new PgBoss({ connectionString, schema: "pgboss", migrate: false, createSchema: false, reindex: false, schedule: false, supervise: false });
  const pool = new pg.Pool({ connectionString });
  const startedAt: number[] = [];
  const handler = vi.fn(async () => { startedAt.push(Date.now()); await new Promise((resolve) => setTimeout(resolve, 1500)); return ok(undefined); });
  try {
    await Promise.all([provider.start(), sender.start()]);
    await provider.schedule(name, "* * * * *", handler, { tz: "America/Lima", policy: stockDeductionRecoveryPolicy });
    await sender.send(name, null);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 15_000, interval: 100 });
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const sentAt = Date.now();
    await sender.send(name, null);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2), { timeout: 15_000, interval: 100 });
    // The recovery bound of a minute depends on a fresh cron job starting promptly.
    expect(startedAt[1]! - sentAt).toBeLessThan(5000);
  } finally {
    await sender.stop({ graceful: false });
    await provider.stop();
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
