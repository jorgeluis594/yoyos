import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { listOrders } from "@core/src/features/orders/application/read-orders";

test("validates list criteria before reading", async () => {
  const find = vi.fn(async () => ok({ items: [], page: 1, pageSize: 20, total: 0 }));
  expect(await listOrders({ page: 0, customer: { kind: "all" } }, find)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(await listOrders({ page: 1.5, customer: { kind: "all" } }, find)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(await listOrders({ page: 1, customer: { kind: "all" }, completedFrom: new Date("2026-09-28"), completedBefore: new Date("2026-09-27") }, find))
    .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(find).not.toHaveBeenCalled();
  expect(await listOrders({ page: 1, customer: { kind: "all" } }, find)).toMatchObject({ success: true });
});
