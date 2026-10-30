import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { DispatchDate } from "@shared/dispatch-date";
import { describeDispatchStock, listDispatchQueue, type ListDispatchQueueDependencies } from "@core/src/features/orders/application/list-dispatch-queue";
import type { DispatchCandidate } from "@core/src/features/orders/domain/dispatch-readiness";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantStock } from "@core/src/features/orders/domain/stock-deduction";
import type { VariantId } from "@core/src/features/products/domain/product";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const camisaM = uuid(11) as VariantId;
const today = "2026-10-30" as DispatchDate;
const access = { companyId: "company-1" as CompanyId, userId: "user-1" as UserId };
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const candidate = (number: number, date: string, overrides: Partial<DispatchCandidate> = {}): DispatchCandidate => ({ id: uuid(number) as OrderId,
  createdAt: new Date("2026-10-20T10:00:00Z"), cancelled: false, stockDeducted: false, deliveryStatus: "pending", total: money(80),
  items: [{ variantId: camisaM, quantity: 1 as never }], confirmedPayments: [{ amount: money(80), deductStockIfPartial: false }],
  number: number as OrderNumber, scheduledDispatchDate: date as DispatchDate, deliveryMethod: "home", hasReportedPayment: false, ...overrides });
const aggregateOf = (id: OrderId) => ({ id, number: Number(id.slice(-12)) }) as unknown as OrderAggregate;

function dependencies(candidates: readonly DispatchCandidate[] | "too_many", overrides: Partial<ListDispatchQueueDependencies> = {}) {
  const deps = {
    inSnapshot: vi.fn(<T,>(read: () => Promise<T>) => read()),
    findDispatchCandidates: vi.fn(async () => ok(candidates)),
    readStock: vi.fn(async () => ok(new Map([[camisaM, 10]]) as unknown as VariantStock)),
    findAggregatesByIds: vi.fn(async (ids: readonly OrderId[]) => ok(ids.map(aggregateOf))),
    countUndatedPending: vi.fn(async () => ok(1)),
    maxCandidates: 5000,
    ...overrides,
  } satisfies ListDispatchQueueDependencies;
  return deps;
}

test("counts overdue and today orders and their ready ones on every page", async () => {
  const members = [...Array.from({ length: 3 }, (_, index) => candidate(1001 + index, "2026-10-28")),
    ...Array.from({ length: 25 }, (_, index) => candidate(1100 + index, "2026-10-30", index < 20 ? {} : { confirmedPayments: [] }))];
  const deps = dependencies(members);
  const first = await listDispatchQueue({ today, page: 1 }, access, deps);
  const second = await listDispatchQueue({ today, page: 2 }, access, deps);
  if (!first.success || !second.success) throw new Error("expected success");
  expect(first.data.summary).toEqual({ overdue: 3, overdueReady: 3, today: 25, todayReady: 20 });
  expect(second.data.summary).toEqual(first.data.summary);
  expect(first.data.entries.map((entry) => entry.group)).toEqual([...Array(3).fill("overdue"), ...Array(17).fill("today")]);
  expect(second.data.entries).toHaveLength(8);
  expect(first.data).toMatchObject({ page: 1, total: 28, undatedPending: 1 });
  expect(first.data.entries[0]).toMatchObject({ readiness: { kind: "ready", operation: "ship" } });
});

test("loads full orders only for the page", async () => {
  const members = Array.from({ length: 45 }, (_, index) => candidate(1001 + index, "2026-10-29"));
  const deps = dependencies(members);
  const result = await listDispatchQueue({ today, page: 3 }, access, deps);
  expect(result.success && result.data.entries).toHaveLength(5);
  expect(deps.findAggregatesByIds).toHaveBeenCalledTimes(1);
  expect(deps.findAggregatesByIds.mock.calls[0]![0]).toHaveLength(5);
  expect(deps.findDispatchCandidates).toHaveBeenCalledWith(today, 5000, "company-1");
  expect(deps.inSnapshot).toHaveBeenCalledTimes(1);
});

test("reads stock once and only for orders that need it", async () => {
  const deps = dependencies([candidate(1001, "2026-10-30"), candidate(1002, "2026-10-30", { confirmedPayments: [] })]);
  await listDispatchQueue({ today, page: 1 }, access, deps);
  expect(deps.readStock).toHaveBeenCalledTimes(1);
  const noStock = dependencies([candidate(1002, "2026-10-30", { confirmedPayments: [] })]);
  await listDispatchQueue({ today, page: 1 }, access, noStock);
  expect(noStock.readStock).not.toHaveBeenCalled();
});

test("answers queue too large above the candidate ceiling instead of a partial queue", async () => {
  const deps = dependencies("too_many");
  expect(await listDispatchQueue({ today, page: 1 }, access, deps)).toMatchObject({ success: false, error: { code: "QUEUE_TOO_LARGE" } });
  expect(deps.findAggregatesByIds).not.toHaveBeenCalled();
});

test("returns a persistence failure instead of an empty queue when the read fails", async () => {
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
  expect(await listDispatchQueue({ today, page: 1 }, access, dependencies([], { findDispatchCandidates: async () => failure })))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  expect(await listDispatchQueue({ today, page: 1 }, access, dependencies([candidate(1001, "2026-10-30")], { readStock: async () => failure })))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  expect(await listDispatchQueue({ today, page: 1 }, access, dependencies([candidate(1001, "2026-10-30")], { findAggregatesByIds: async () => failure })))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  expect(await listDispatchQueue({ today, page: 1 }, access, dependencies([], { countUndatedPending: async () => failure })))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});

test("rejects a page that is not a positive integer before reading", async () => {
  const deps = dependencies([]);
  expect(await listDispatchQueue({ today, page: 0 }, access, deps)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(deps.findDispatchCandidates).not.toHaveBeenCalled();
});

test("fails when a page order vanished instead of dropping it silently", async () => {
  const deps = dependencies([candidate(1001, "2026-10-30")], { findAggregatesByIds: async () => ok([]) });
  expect(await listDispatchQueue({ today, page: 1 }, access, deps)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
});

test("describes the dispatch stock of full orders with one stock read for those that need it", async () => {
  const readStock = vi.fn(async () => ok(new Map([[camisaM, 3]]) as unknown as VariantStock));
  const item = { variantId: camisaM, quantity: 4 };
  const partial = { id: uuid(1), createdAt: new Date(), cancelled: false, stockDeducted: false, deliveryStatus: "pending", total: money(80), items: [item],
    payments: [{ status: "confirmed", amount: money(30), deductStockIfPartial: false }] } as unknown as OrderAggregate;
  const unpaid = { ...partial, id: uuid(2), payments: [] } as unknown as OrderAggregate;
  const result = await describeDispatchStock([partial, unpaid], { readStock, inSnapshot: (read) => read() });
  if (!result.success) throw new Error("expected success");
  expect(result.data.get(partial.id)).toEqual({ stockDue: null, shortAtCurrentStock: [camisaM] });
  expect(result.data.get(unpaid.id)).toEqual({ stockDue: null, shortAtCurrentStock: [] });
  expect(readStock).toHaveBeenCalledTimes(1);
});
