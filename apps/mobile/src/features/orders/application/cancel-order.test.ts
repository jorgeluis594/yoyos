import { err, ok } from "@shared/functional";
import { createCancellationOperations, type CancelledOrderState, type CancellationOrderState, type CancellationRequestError } from "@mobile/features/orders/application/cancel-order";

const cancelled: CancelledOrderState = { id: "order", status: "cancelled", cancelled: true, deliveryStatus: "pending", stockDeducted: true, deliveredAt: null, completedAt: null };
const active: CancellationOrderState = { id: "order", status: "active", cancelled: false, deliveryStatus: "pending" };
const shipped: CancellationOrderState = { id: "order", status: "active", cancelled: false, deliveryStatus: "shipped" };

test("confirmed cancellation uses one write and manual verification uses only one read", async () => {
  const cancel = jest.fn(async () => ok(cancelled));
  const readState = jest.fn(async () => ok(cancelled));
  const operations = createCancellationOperations({ cancel, readState });
  expect(await operations.cancelOrder("order")).toEqual(ok({ kind: "cancelled", order: cancelled }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(readState).not.toHaveBeenCalled();
  expect(await operations.checkCancellation("order")).toEqual(ok({ kind: "cancelled", order: cancelled }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(readState).toHaveBeenCalledTimes(1);
});

test.each(["NETWORK_ERROR", "SERVER_ERROR", "SERVICE_UNAVAILABLE", "INVALID_RESPONSE", "INVALID_TRANSITION"] as const)("%s checks once without repeating the write", async code => {
  for (const [order, kind] of [[cancelled, "cancelled"], [active, "still_active"], [shipped, "dispatched"]] as const) {
    const cancel = jest.fn(async () => err({ code, message: "Failed" }));
    const readState = jest.fn(async () => ok(order));
    expect(await createCancellationOperations({ cancel, readState }).cancelOrder("order")).toEqual(ok({ kind, order }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(readState).toHaveBeenCalledTimes(1);
  }
});

test("failed verification remains uncertain while absence, auth and obsolete session remain failures", async () => {
  const lost: CancellationRequestError = { code: "NETWORK_ERROR", message: "Lost" };
  const cancel = jest.fn(async () => err(lost));
  expect(await createCancellationOperations({ cancel, readState: async () => err(lost) }).cancelOrder("order"))
    .toEqual(ok({ kind: "uncertain", orderId: "order", cause: lost }));
  for (const code of ["ORDER_NOT_FOUND", "UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY", "OPERATION_CANCELLED", "SECURE_STORAGE_ERROR"] as const) {
    const failure = err({ code, message: "Rejected" });
    expect(await createCancellationOperations({ cancel, readState: async () => failure }).cancelOrder("order")).toEqual(failure);
    const readState = jest.fn(async () => ok(cancelled));
    expect(await createCancellationOperations({ cancel: async () => failure, readState }).cancelOrder("order")).toEqual(failure);
    expect(readState).not.toHaveBeenCalled();
  }
});

// @ts-expect-error A cancelled result cannot represent a dispatched order.
const invalidCancelled: CancelledOrderState = { ...cancelled, deliveryStatus: "shipped" };
void invalidCancelled;
