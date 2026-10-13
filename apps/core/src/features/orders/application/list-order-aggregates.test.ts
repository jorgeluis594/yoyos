import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { DispatchDate } from "@shared/dispatch-date";
import { listOrderAggregates, parseScheduledDispatchFilter } from "@core/src/features/orders/application/list-order-aggregates";
import type { CompanyId } from "@core/src/features/orders/domain/order";

const day = (value: string) => value as DispatchDate;

test("normalizes scheduled filters and rejects incompatible ones", () => {
  expect(parseScheduledDispatchFilter({})).toEqual({ success: true, data: { kind: "all" } });
  expect(parseScheduledDispatchFilter({ unscheduled: "true" })).toEqual({ success: true, data: { kind: "unscheduled" } });
  expect(parseScheduledDispatchFilter({ scheduledFrom: day("2026-10-01") })).toMatchObject({ data: { kind: "from" } });
  expect(parseScheduledDispatchFilter({ scheduledThrough: day("2026-10-01") })).toMatchObject({ data: { kind: "through" } });
  expect(parseScheduledDispatchFilter({ scheduledFrom: day("2026-10-01"), scheduledThrough: day("2026-10-01") })).toMatchObject({ data: { kind: "between" } });
  expect(parseScheduledDispatchFilter({ unscheduled: "true", scheduledFrom: day("2026-10-01") })).toMatchObject({ success: false });
  expect(parseScheduledDispatchFilter({ scheduledFrom: day("2026-10-02"), scheduledThrough: day("2026-10-01") })).toMatchObject({ success: false });
});

test("rejects inverted real dispatch interval before reading", async () => {
  const find = vi.fn(async () => ok({ items: [], page: 1, pageSize: 20 as const, total: 0 }));
  const context = { companyId: "c" as CompanyId } as Parameters<typeof listOrderAggregates>[1];
  const base = { page: 1, customer: { kind: "all" } } as const;
  expect(await listOrderAggregates({ ...base, shippedFrom: new Date("2026-10-02"), shippedBefore: new Date("2026-10-01") }, context, find))
    .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(find).not.toHaveBeenCalled();
});
