import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { getOrder, listOrders } from "@core/src/features/orders/application/read-orders";

const id = "00000000-0000-4000-8000-000000000001";

test("validates list criteria before reading", async () => {
  const find = vi.fn(async () => ok({ items: [], page: 1, pageSize: 20, total: 0 }));
  expect(await listOrders({ page: 0, customer: { kind: "all" } }, find)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(await listOrders({ page: 1.5, customer: { kind: "all" } }, find)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(await listOrders({ page: 1, customer: { kind: "all" }, completedFrom: new Date("2026-09-28"), completedBefore: new Date("2026-09-27") }, find))
    .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(find).not.toHaveBeenCalled();
  expect(await listOrders({ page: 1, customer: { kind: "all" } }, find)).toMatchObject({ success: true });
});

test("distinguishes missing order, persistence failure and invalid ID", async () => {
  const find = vi.fn(async () => ok(null));
  expect(await getOrder("bad", find)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(find).not.toHaveBeenCalled();
  expect(await getOrder(id, find)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
  expect(await getOrder(id, async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database unavailable" })))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});
