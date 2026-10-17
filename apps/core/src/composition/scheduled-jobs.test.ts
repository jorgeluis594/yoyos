import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { catalogOrderTtlDays, deleteExpiredCatalogOrdersJob, registerScheduledJobs, scheduledJobs } from "@core/src/composition/scheduled-jobs";
import { createInMemoryEventBus } from "@core/src/shared/events/infrastructure/in-memory-provider";
import { log } from "@core/src/shared/infrastructure/logger";

const context = { signal: new AbortController().signal, attempt: 1 };

test("registers the daily catalog cleanup at 04:00 Lima and releases it on cleanup", async () => {
  const bus = createInMemoryEventBus();
  const registered = await registerScheduledJobs(bus);
  expect(bus.scheduled()).toEqual([expect.objectContaining({ name: "delete-expired-catalog-orders", cron: "0 4 * * *", tz: "America/Lima" })]);
  if (registered.success) await registered.data();
  expect(bus.scheduled()).toEqual([]);
});

test("releases already registered jobs when a later job cannot be scheduled", async () => {
  const bus = createInMemoryEventBus();
  const [job] = scheduledJobs();
  expect(await registerScheduledJobs(bus, [job, job])).toMatchObject({ success: false, error: { code: "INVALID_SUBSCRIPTION" } });
  expect(bus.scheduled()).toEqual([]);
});

test("catalog order ttl defaults to 7 days and rejects invalid values", () => {
  expect(catalogOrderTtlDays(undefined)).toBe(7);
  expect(catalogOrderTtlDays("3")).toBe(3);
  for (const value of ["0", "1.5", "abc", ""]) expect(() => catalogOrderTtlDays(value)).toThrow();
});

test("cleanup job deletes before the ttl cutoff and fails for a retry when the listing fails", async () => {
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const now = () => new Date("2026-10-17T09:00:00.000Z");
  const deleteOrders = vi.fn(async () => ok({ companies: 2, deleted: 5, failedCompanies: 1 }));
  expect(await deleteExpiredCatalogOrdersJob(7, now, deleteOrders)(context)).toEqual(ok(undefined));
  expect(deleteOrders).toHaveBeenCalledWith({ cutoff: new Date("2026-10-10T09:00:00.000Z") });
  expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: "catalog_orders_deleted", companies: 2, deleted: 5,
    failedCompanies: 1, cutoff: "2026-10-10T09:00:00.000Z", durationMs: 0 }), expect.any(String));

  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
  expect(await deleteExpiredCatalogOrdersJob(7, now, async () => failure)(context))
    .toEqual(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down", retryable: true }));
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "catalog_order_cleanup_failed", errorCode: "PERSISTENCE_UNAVAILABLE" }), expect.any(String));
  info.mockRestore();
  error.mockRestore();
});
