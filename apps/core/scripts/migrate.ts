import { execFileSync } from "node:child_process";
import pg from "pg";
import { log } from "@core/src/shared/infrastructure/logger";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
const started = performance.now();
let databaseStartedAt: Date | undefined;
let errorCode = "MIGRATION_OBSERVATION_FAILED";
async function count(table: "Order" | "OrderBuyer") {
  const exists = (await db.query("SELECT to_regclass($1) AS name", [`public."${table}"`])).rows[0].name;
  return exists ? (await db.query(`SELECT count(*)::text AS count FROM "${table}"`)).rows[0].count : "0";
}
log.info({ event: "migration_deployment_started" }, "Database migration deployment started");
try {
  await db.connect();
  databaseStartedAt = (await db.query("SELECT clock_timestamp() AS at")).rows[0].at;
  errorCode = "MIGRATION_DEPLOY_FAILED";
  // Prisma output can include SQL row values. Keep it out of deployment logs;
  // the migration ledger below supplies identifiers and status without data.
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "pipe" });
  errorCode = "MIGRATION_OBSERVATION_FAILED";
  log.info({ event: "migration_deployment_completed", durationMs: Math.round(performance.now() - started),
    numberedOrders: await count("Order"), buyerSnapshots: await count("OrderBuyer"),
  }, "Database migration deployment completed");
} catch {
  log.error({ event: "migration_deployment_failed", errorCode, durationMs: Math.round(performance.now() - started) }, "Database migration deployment failed");
  process.exitCode = 1;
} finally {
  if (databaseStartedAt) {
    try {
      const ledger = await db.query(`SELECT migration_name, started_at, finished_at,
        CASE WHEN logs LIKE '%Order buyer snapshot migration is incomplete%' THEN 'ORDER_BUYER_BACKFILL_INCOMPLETE'
          WHEN logs LIKE '%Order_number_valid%' THEN 'ORDER_NUMBER_INVALID'
          WHEN logs LIKE '%Company_nextOrderNumber_valid%' THEN 'ORDER_COUNTER_INVALID'
          ELSE NULL END AS invariant_code,
        extract(epoch FROM (coalesce(finished_at, clock_timestamp()) - started_at)) * 1000 AS duration_ms
        FROM "_prisma_migrations" WHERE started_at >= $1 OR (finished_at IS NULL AND rolled_back_at IS NULL) ORDER BY started_at`, [databaseStartedAt]);
      for (const row of ledger.rows) log.info({ event: "migration_attempt_completed", migration: row.migration_name,
        startedAt: row.started_at, finishedAt: row.finished_at, durationMs: Number(row.duration_ms),
        outcome: row.finished_at ? "completed" : "incomplete", ...(row.invariant_code ? { errorCode: row.invariant_code } : {}),
      }, "Database migration attempt recorded");
      if (process.exitCode) log.info({ event: "migration_persisted_counts", orderCount: await count("Order"), buyerSnapshots: await count("OrderBuyer") }, "Persisted counts after migration failure");
    } catch {
      log.error({ event: "migration_ledger_unavailable", errorCode: "MIGRATION_OBSERVATION_FAILED" }, "Unable to read migration ledger");
      process.exitCode = 1;
    }
  }
  await db.end();
}
