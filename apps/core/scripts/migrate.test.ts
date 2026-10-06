import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { expect, test } from "vitest";

test("migration deployment reports safe aggregate evidence and fails without printing database details", async () => {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Migration tests require administrative test credentials");
  const dbName = `migration_logs_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const run = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 30_000,
    });
    const migrated = run();
    expect(migrated.status, migrated.stderr).toBe(0);
    const logs = migrated.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(logs).toContainEqual(expect.objectContaining({ event: "migration_deployment_completed", numberedOrders: "0", buyerSnapshots: "0" }));
    expect(logs).toContainEqual(expect.objectContaining({ event: "migration_attempt_completed", migration: "20261005061438_separate_order_buyer", outcome: "completed" }));
    await db.connect();
    await db.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, logs, started_at)
      VALUES ($1, 'test', '20261005000000_test_failure', 'Order buyer snapshot migration is incomplete: Private buyer +51999999999', clock_timestamp())`, [randomUUID()]);
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('"errorCode":"MIGRATION_DEPLOY_FAILED"');
    expect(failed.stdout).toContain('"errorCode":"ORDER_BUYER_BACKFILL_INCOMPLETE"');
    expect(failed.stdout).toContain('"event":"migration_persisted_counts"');
    expect(failed.stdout + failed.stderr).not.toMatch(/Private buyer|51999999999/);
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
});
