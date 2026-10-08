import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import { action } from "@core/app/routes/order-new";
import * as composition from "@core/src/features/orders/composition";
import { createDeliveryRequestContext } from "@core/app/delivery-cost-context";
import { privateUserContext } from "@core/app/private-user-context";
import type { ReadyAccess } from "@core/src/features/users";

const companyId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const input = { id: orderId, contactId: null, items: [{ variantId: "00000000-0000-4000-8000-000000000003", quantity: 1 }],
  delivery: { delivery: { method: "home", rateId: "00000000-0000-4000-8000-000000000004", recipient: { name: " Ana ", phone: " 999 ", identity: { kind: "absent" } },
    destination: { districtCode: "040110", address: " Street ", instructions: null } }, expectedPrice: { amount: 8, currency: "PEN" } } };
async function save(body: unknown) {
  const context = createDeliveryRequestContext();
  context.set(privateUserContext, { company: { id: companyId, country: "PE" }, user: { id: "seller" } } as unknown as ReadyAccess);
  return action({ context, request: new Request("http://localhost/es-PE/orders/new", { method: "POST", body: new URLSearchParams({ order: JSON.stringify(body) }) }) } as ActionFunctionArgs);
}
afterEach(() => vi.restoreAllMocks());

test("creates with reviewed delivery and trusted seller access", async () => {
  const create = vi.spyOn(composition, "createConfiguredOrder").mockResolvedValue({ success: false, error: { code: "RATE_UNAVAILABLE", message: "Private detail" } });
  expect(await save(input)).toMatchObject({ code: "RATE_UNAVAILABLE" });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: orderId, delivery: { delivery: { ...input.delivery.delivery,
    recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { ...input.delivery.delivery.destination, address: "Street" } }, expectedPrice: input.delivery.expectedPrice } }),
    { companyId, userId: "seller" }, undefined);
});

test("returns the current price without turning a rejected creation into success", async () => {
  vi.spyOn(composition, "createConfiguredOrder").mockResolvedValue({ success: false, error: { code: "TOTAL_CHANGED", message: "Private detail", currentPrice: { amount: 10, currency: "PEN" } } });
  expect(await save(input)).toMatchObject({ code: "TOTAL_CHANGED", currentPrice: { amount: 10, currency: "PEN" } });
});

test("rejects manual charge and forged snapshot claims on rated creation", async () => {
  const create = vi.spyOn(composition, "createConfiguredOrder");
  for (const body of [{ ...input, companyId: "forged" }, { ...input, delivery: { ...input.delivery, chargeDeliveryToCustomer: false } },
    { ...input, delivery: { ...input.delivery, delivery: { ...input.delivery.delivery, recordedBy: { kind: "buyer" } } } },
    { ...input, delivery: { ...input.delivery, delivery: { ...input.delivery.delivery, destination: { ...input.delivery.delivery.destination, districtCode: "999999" } } } }]) {
    expect(await save(body)).toMatchObject({ code: "INVALID_ORDER" });
  }
  expect(create).not.toHaveBeenCalled();
});
