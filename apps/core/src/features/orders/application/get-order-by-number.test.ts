import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { getOrderAggregateByNumber } from "@core/src/features/orders/application/get-order-by-number";
import { hasAnyOrder } from "@core/src/features/orders/application/has-any-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

const access = { companyId: "company-1" as CompanyId, userId: "user-1" as UserId };

test("answers order not found for an unknown number", async () => {
  const findOrderByNumber = vi.fn(async () => ok(null));
  expect(await getOrderAggregateByNumber({ number: 1999 as OrderNumber }, access, findOrderByNumber))
    .toEqual({ success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  expect(findOrderByNumber).toHaveBeenCalledWith(1999, "company-1");
});

test("returns the order found by its number", async () => {
  const order = { number: 1001 } as OrderAggregate;
  expect(await getOrderAggregateByNumber({ number: 1001 as OrderNumber }, access, async () => ok(order))).toEqual({ success: true, data: order });
});

test("passes a persistence failure through instead of reporting a missing order", async () => {
  const failure = { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" } };
  expect(await getOrderAggregateByNumber({ number: 1001 as OrderNumber }, access, async () => failure)).toEqual(failure);
  expect(await hasAnyOrder({}, access, async () => failure)).toEqual(failure);
});

test("tells whether the store has any confirmed order", async () => {
  const existsOrder = vi.fn(async () => ok(true));
  expect(await hasAnyOrder({}, access, existsOrder)).toEqual({ success: true, data: true });
  expect(existsOrder).toHaveBeenCalledWith("company-1");
});
