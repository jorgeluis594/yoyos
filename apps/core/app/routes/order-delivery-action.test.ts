import { log } from "@core/src/shared/infrastructure/logger";
import { afterEach, expect, test, vi } from "vitest";
import { action } from "@core/app/routes/order-detail";
import * as composition from "@core/src/features/orders/composition";
import { createDeliveryRequestContext } from "@core/app/delivery-cost-context";
import { privateUserContext } from "@core/app/private-user-context";
import type { ReadyAccess } from "@core/src/features/users";

const orderId = "00000000-0000-4000-8000-000000000003";
const access = { company: { id: "00000000-0000-4000-8000-000000000001" }, user: { id: "current-seller" } };
const input = { delivery: { method: "store", recipient: { name: " Ana ", phone: " 999 ", identity: { kind: "absent" } } }, chargeDeliveryToCustomer: false };
async function save(body: unknown) {
  const context = createDeliveryRequestContext();
  context.set(privateUserContext, access as unknown as ReadyAccess);
  const request = new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return action({ params: { orderId }, context, request, url: new URL(request.url), pattern: "/:locale/orders/:orderId" });
}
afterEach(() => vi.restoreAllMocks());

test("rejects price, snapshot and authorship claims before calling the use case", async () => {
  const assign = vi.spyOn(composition, "setConfiguredOrderDelivery");
  for (const body of [{ ...input, cost: 0 }, { ...input, companyId: "forged" },
    { ...input, delivery: { ...input.delivery, recordedBy: { kind: "buyer" } } },
    { ...input, delivery: { ...input.delivery, pickupPoint: { name: "Fake", address: "Fake", instructions: null } } }]) {
    expect(await save(body)).toMatchObject({ error: "invalid" });
  }
  expect(assign).not.toHaveBeenCalled();
});

test("uses session access and the default unresolved cost capability", async () => {
  const assign = vi.spyOn(composition, "setConfiguredOrderDelivery").mockResolvedValue({ success: false,
    error: { code: "DELIVERY_UNAVAILABLE", message: "Unavailable" } });
  expect(await save(input)).toMatchObject({ error: "unavailable" });
  expect(assign).toHaveBeenCalledWith({ orderId, delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, chargeDeliveryToCustomer: false },
    { companyId: access.company.id, userId: access.user.id }, undefined);
});

test.each([["DELIVERY_LOCKED", "locked"], ["ORDER_CANCELLED", "locked"], ["DELIVERY_METHOD_DISABLED", "disabled"], ["INSUFFICIENT_STOCK", "stockError"], ["COURIER_UNAVAILABLE", "courierUnavailable"]] as const)("maps %s to a recoverable message", async (code, message) => {
  vi.spyOn(composition, "setConfiguredOrderDelivery").mockResolvedValue({ success: false, error: { code, message: "Internal detail" } });
  expect(await save(input)).toMatchObject({ error: message });
});


test("unexpected action failures have one safe bounded server context and no success reply", async () => {
  vi.spyOn(composition, "setConfiguredOrderDelivery").mockRejectedValue(new Error("Private detail"));
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await save(input)).toMatchObject({ error: "saveError" });
  expect(failure).toHaveBeenCalledOnce();
  expect(failure.mock.calls[0][0]).toMatchObject({ event: "order_delivery_request_failed", entryPoint: "web_action", operation: "set_order_delivery", orderId, userId: access.user.id, errorCode: "INTERNAL_ERROR" });
});
