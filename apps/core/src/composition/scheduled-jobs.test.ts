import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { catalogOrderTtlDays, deleteExpiredCatalogOrdersJob, deleteExpiredMessageTracesJob, registerScheduledJobs, reportBlockedChatKeysJob, scheduledJobs } from "@core/src/composition/scheduled-jobs";
import { createInMemoryEventBus } from "@core/src/shared/events/infrastructure/in-memory-provider";
import { log } from "@core/src/shared/infrastructure/logger";

const noBlockedKeys = { listBlockedKeys: async () => ok([] as readonly string[]) };
const context = { signal: new AbortController().signal, attempt: 1 };

test("registers the daily catalog cleanup at 04:00 Lima and releases it on cleanup", async () => {
  const bus = createInMemoryEventBus();
  const registered = await registerScheduledJobs(bus, scheduledJobs(7, { reader: noBlockedKeys, handlerIds: [] }, async () => ok(undefined)));
  expect(bus.scheduled()).toContainEqual(expect.objectContaining({ name: "delete-expired-catalog-orders", cron: "0 4 * * *", tz: "America/Lima" }));
  if (registered.success) await registered.data();
  expect(bus.scheduled()).toEqual([]);
});

test("releases already registered jobs when a later job cannot be scheduled", async () => {
  const bus = createInMemoryEventBus();
  const [job] = scheduledJobs(7, { reader: noBlockedKeys, handlerIds: [] }, async () => ok(undefined));
  expect(await registerScheduledJobs(bus, [job, job])).toMatchObject({ success: false, error: { code: "INVALID_SUBSCRIPTION" } });
  expect(bus.scheduled()).toEqual([]);
});

test("catalog order ttl defaults to 7 days and rejects invalid values", () => {
  expect(catalogOrderTtlDays(undefined)).toEqual(ok(7));
  expect(catalogOrderTtlDays("3")).toEqual(ok(3));
  for (const value of ["0", "1.5", "abc", ""]) expect(catalogOrderTtlDays(value)).toMatchObject({ success: false, error: { code: "INVALID_CONFIGURATION" } });
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

test("registers the blocked chat keys check every five minutes", async () => {
  const bus = createInMemoryEventBus();
  await registerScheduledJobs(bus, scheduledJobs(7, { reader: noBlockedKeys, handlerIds: [] }, async () => ok(undefined)));
  expect(bus.scheduled()).toContainEqual(expect.objectContaining({ name: "report-blocked-chat-keys", cron: "*/5 * * * *" }));
});

test("the blocked-keys check reports nothing when no ordered queue exists yet", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const reader = { listBlockedKeys: vi.fn(async () => ok([] as readonly string[])) };
  expect(await reportBlockedChatKeysJob(reader, [])(context)).toEqual(ok(undefined));
  expect(reader.listBlockedKeys).not.toHaveBeenCalled();
  expect(await reportBlockedChatKeysJob(reader, ["apply-chat-message"])(context)).toEqual(ok(undefined));
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test("logs orders_chat_queue_blocked with the blocked key count and succeeds", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const reader = { listBlockedKeys: async () => ok(["chat-1", "chat-2"] as readonly string[]) };
  expect(await reportBlockedChatKeysJob(reader, ["apply-chat-message"])(context)).toEqual(ok(undefined));
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "orders_chat_queue_blocked", handler: "apply-chat-message", blockedKeys: 2 }), expect.any(String));
  error.mockRestore();
});

test("fails for a retry when the blocked keys cannot be read", async () => {
  const reader = { listBlockedKeys: async () => err({ code: "EVENT_BUS_UNAVAILABLE" as const, message: "down" }) };
  expect(await reportBlockedChatKeysJob(reader, ["apply-chat-message"])(context))
    .toEqual(err({ code: "EVENT_BUS_UNAVAILABLE", message: "down", retryable: true }));
});

test("registers the stock deduction recovery every minute with a no-retry policy", async () => {
  const bus = createInMemoryEventBus();
  await registerScheduledJobs(bus, scheduledJobs(7, { reader: noBlockedKeys, handlerIds: [] }, async () => ok(undefined)));
  expect(bus.scheduled()).toContainEqual(expect.objectContaining({ name: "recover-due-stock-deductions", cron: "* * * * *",
    policy: { retryLimit: 0, expireInSeconds: 58, queuePolicy: "standard" } }));
});

test("registers the hourly message trace cleanup", async () => {
  const bus = createInMemoryEventBus();
  await registerScheduledJobs(bus, scheduledJobs(7, { reader: noBlockedKeys, handlerIds: [] }, async () => ok(undefined)));
  expect(bus.scheduled()).toContainEqual(expect.objectContaining({ name: "delete-expired-message-traces", cron: "0 * * * *", tz: "America/Lima" }));
});

test("the trace cleanup deletes what expired by now and fails for a retry when the listing fails", async () => {
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const now = new Date("2026-10-10T09:00:00Z");
  const deleteTraces = vi.fn(async () => ok({ companies: 2, deletedTraces: 1200, deletedTexts: 3, failedCompanies: 0 }));
  expect(await deleteExpiredMessageTracesJob(() => now, deleteTraces, 100)(context)).toEqual(ok(undefined));
  expect(deleteTraces).toHaveBeenCalledWith({ cutoff: now, batchSize: 100 });
  expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: "message_traces_deleted", deletedTraces: 1200, deletedTexts: 3, companies: 2, failedCompanies: 0 }), expect.any(String));
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  expect(await deleteExpiredMessageTracesJob(() => now, async () => err(failure))(context)).toEqual(err({ ...failure, retryable: true }));
  info.mockRestore();
  error.mockRestore();
});
