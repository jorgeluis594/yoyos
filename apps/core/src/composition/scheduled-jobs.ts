import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { deleteConfiguredExpiredCatalogOrders } from "@core/src/features/orders/composition";
import { log } from "@core/src/shared/infrastructure/logger";
import type {
  EventBusError, JobScheduler, ScheduledJobHandler, Unsubscribe,
} from "@core/src/shared/events/application/contracts";

export type ScheduledJob = Readonly<{ name: string; cron: string; tz: string; handler: ScheduledJobHandler }>;

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

export function scheduledJobs(catalogOrderTtl: number): readonly ScheduledJob[] {
  return [{ name: "delete-expired-catalog-orders", cron: "0 4 * * *", tz: "America/Lima",
    handler: deleteExpiredCatalogOrdersJob(catalogOrderTtl) }];
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
    const registered = await scheduler.schedule(job.name, job.cron, job.handler, { tz: job.tz });
    if (!registered.success) {
      await cleanup();
      return registered;
    }
    cleanups.push(registered.data);
  }
  return ok(cleanup);
}
