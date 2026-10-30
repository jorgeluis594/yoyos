import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { deleteConfiguredExpiredCatalogOrders } from "@core/src/features/orders/composition";
import { STOCK_DEDUCTION_RECOVERY_CRON } from "@core/src/features/orders/application/recover-due-stock-deductions";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import { log } from "@core/src/shared/infrastructure/logger";
import type {
  AnyEventSubscription, BlockedKeysReader, EventBusError, JobScheduler, ScheduledJobHandler, ScheduledJobPolicy, Unsubscribe,
} from "@core/src/shared/events/application/contracts";

export type ScheduledJob = Readonly<{ name: string; cron: string; tz: string; handler: ScheduledJobHandler; policy?: ScheduledJobPolicy }>;

const dayMs = 24 * 60 * 60 * 1000;

export function catalogOrderTtlDays(value = process.env.CATALOG_ORDER_TTL_DAYS): Result<number, Readonly<{ code: "INVALID_CONFIGURATION"; message: string }>> {
  const parsed = z.coerce.number().int().min(1).default(7).safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_CONFIGURATION", message: "CATALOG_ORDER_TTL_DAYS must be a positive integer" });
}

export function deleteExpiredCatalogOrdersJob(
  ttlDays: number,
  now: () => Date = () => new Date(),
  deleteOrders = deleteConfiguredExpiredCatalogOrders,
): ScheduledJobHandler {
  return async () => {
    const started = now();
    const cutoff = new Date(started.getTime() - ttlDays * dayMs);
    const result = await deleteOrders({ cutoff });
    if (!result.success) {
      log.error({ event: "catalog_order_cleanup_failed", errorCode: result.error.code, err: result.error }, "Catalog order cleanup failed");
      return err({ ...result.error, retryable: true });
    }
    log.info({ event: "catalog_orders_deleted", ...result.data, cutoff: cutoff.toISOString(),
      durationMs: now().getTime() - started.getTime() }, "Expired catalog orders deleted");
    return ok(undefined);
  };
}

/** Ids of the handlers whose queue holds a chat key while a job is failed (those with an `orderingKey`). */
export function orderedHandlerIds(handlers: readonly AnyEventSubscription<AppEvents>[]): readonly string[] {
  return handlers.filter(handler => handler.policy.orderingKey !== undefined).map(handler => handler.id);
}

/** A failed job holds its ordering key until its dead-letter handler deletes it, so a key listed here is a stuck chat. */
export function reportBlockedChatKeysJob(reader: BlockedKeysReader, handlerIds: readonly string[]): ScheduledJobHandler {
  return async () => {
    for (const handlerId of handlerIds) {
      const blocked = await reader.listBlockedKeys(handlerId);
      if (!blocked.success) {
        log.error({ event: "blocked_chat_keys_check_failed", handlerId, errorCode: blocked.error.code, err: blocked.error }, "Blocked chat keys check failed");
        return err({ ...blocked.error, retryable: true });
      }
      if (blocked.data.length > 0) {
        log.error({ event: "orders_chat_queue_blocked", handler: handlerId, blockedKeys: blocked.data.length }, "Chat queue blocked by a failed job");
      }
    }
    return ok(undefined);
  };
}

/**
 * Recovery runs once a minute with three passes inside the run (pg-boss sends at most one cron job per minute across replicas).
 * No retry (the next minute is the retry) and expiry below the slot, so a stuck run frees the queue before the next one.
 * Not `stately`: measured on pg-boss 12.35, a stately job created after a 40 s run started up to 55 s late, while a standard queue started within 1 s.
 * A run lasts under 55 s (the last pass starts by 45 s and is capped at 10 s), so runs do not overlap; if one did, the listener's row locks keep it correct.
 */
export const stockDeductionRecoveryPolicy: ScheduledJobPolicy = { retryLimit: 0, expireInSeconds: 58, queuePolicy: "standard" };

export function scheduledJobs(
  catalogOrderTtl: number,
  blockedKeys: Readonly<{ reader: BlockedKeysReader; handlerIds: readonly string[] }>,
  recoverStockDeductions: ScheduledJobHandler,
): readonly ScheduledJob[] {
  return [
    { name: "delete-expired-catalog-orders", cron: "0 4 * * *", tz: "America/Lima",
      handler: deleteExpiredCatalogOrdersJob(catalogOrderTtl) },
    { name: "report-blocked-chat-keys", cron: "*/5 * * * *", tz: "America/Lima",
      handler: reportBlockedChatKeysJob(blockedKeys.reader, blockedKeys.handlerIds) },
    { name: "recover-due-stock-deductions", cron: STOCK_DEDUCTION_RECOVERY_CRON, tz: "America/Lima",
      handler: recoverStockDeductions, policy: stockDeductionRecoveryPolicy },
  ];
}

/** Worker only; the web process never schedules. Registered jobs are released when a later one fails. */
export async function registerScheduledJobs(
  scheduler: JobScheduler,
  jobs: readonly ScheduledJob[],
): Promise<Result<Unsubscribe, EventBusError>> {
  const cleanups: Unsubscribe[] = [];
  const cleanup: Unsubscribe = async () => {
    const results = await Promise.all(cleanups.splice(0).map(unsubscribe => unsubscribe()));
    return results.find(result => !result.success) ?? ok(undefined);
  };
  for (const job of jobs) {
    const registered = await scheduler.schedule(job.name, job.cron, job.handler, { tz: job.tz, ...(job.policy ? { policy: job.policy } : {}) });
    if (!registered.success) {
      await cleanup();
      return registered;
    }
    cleanups.push(registered.data);
  }
  return ok(cleanup);
}
