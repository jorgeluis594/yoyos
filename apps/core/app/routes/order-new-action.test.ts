import { afterEach, expect, test, vi } from "vitest";
import { RouterContextProvider, type ActionFunctionArgs } from "react-router";
import { action } from "@core/app/routes/order-new";
import resources from "@core/app/locales";
import { deliverySavedKey } from "@core/src/features/orders/presentation/stock-due";
import * as composition from "@core/src/features/orders/composition";
import { privateUserContext } from "@core/app/private-user-context";
import type { ReadyAccess } from "@core/src/features/users";

const companyId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const input = { id: orderId, items: [{ variantId: "00000000-0000-4000-8000-000000000003", quantity: 1 }],
  delivery: { delivery: { method: "home", rateId: "00000000-0000-4000-8000-000000000004", recipient: { name: " Ana ", phone: " 999 ", identity: { kind: "absent" } },
    destination: { districtCode: "040110", address: " Street ", instructions: null } }, expectedPrice: { amount: 8, currency: "PEN" } } };
async function save(body: unknown) {
  const context = new RouterContextProvider();
  context.set(privateUserContext, { company: { id: companyId, country: "PE" }, user: { id: "seller" } } as unknown as ReadyAccess);
  return action({ context, request: new Request("http://localhost/es-PE/orders/new", { method: "POST", body: new URLSearchParams({ order: JSON.stringify(body) }) }) } as ActionFunctionArgs);
}
afterEach(() => vi.restoreAllMocks());

test("creates with reviewed delivery and trusted seller access", async () => {
  const create = vi.spyOn(composition, "createConfiguredOrder").mockResolvedValue({ success: false, error: { code: "RATE_UNAVAILABLE", message: "Private detail" } });
  expect(await save(input)).toMatchObject({ code: "RATE_UNAVAILABLE" });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: orderId, delivery: { delivery: { ...input.delivery.delivery,
    recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { ...input.delivery.delivery.destination, address: "Street" } }, expectedPrice: input.delivery.expectedPrice } }),
    { companyId, userId: "seller" });
});

test("returns the current price without turning a rejected creation into success", async () => {
  vi.spyOn(composition, "createConfiguredOrder").mockResolvedValue({ success: false, error: { code: "TOTAL_CHANGED", message: "Private detail", currentPrice: { amount: 10, currency: "PEN" } } });
  expect(await save(input)).toMatchObject({ code: "TOTAL_CHANGED", currentPrice: { amount: 10, currency: "PEN" } });
});

test("rejects manual charge and forged snapshot claims on rated creation", async () => {
  const create = vi.spyOn(composition, "createConfiguredOrder");
  for (const body of [{ ...input, companyId: "forged" }, { ...input, delivery: { ...input.delivery, obsoleteCharge: false } },
    { ...input, delivery: { ...input.delivery, delivery: { ...input.delivery.delivery, recordedBy: { kind: "buyer" } } } },
    { ...input, delivery: { ...input.delivery, delivery: { ...input.delivery.delivery, destination: { ...input.delivery.delivery.destination, districtCode: "999999" } } } }]) {
    expect(await save(body)).toMatchObject({ code: "INVALID_ORDER" });
  }
  expect(create).not.toHaveBeenCalled();
});


test("rejects obsolete initial delivery with either charge choice", async () => {
  const create = vi.spyOn(composition, "createConfiguredOrder");
  for (const obsoleteCharge of [true, false]) {
    expect(await save({ ...input, delivery: { delivery: { method: "store", recipient: input.delivery.delivery.recipient }, obsoleteCharge } })).toMatchObject({ code: "INVALID_ORDER" });
  }
  expect(create).not.toHaveBeenCalled();
});

test("returns the variant of an item that is no longer available so the sale can mark it", async () => {
  const variantId = input.items[0].variantId;
  vi.spyOn(composition, "createConfiguredOrder").mockResolvedValue({ success: false, error: { code: "VARIANT_NOT_FOUND", message: "Variant is not available", variantId } });
  expect(await save(input)).toMatchObject({ code: "VARIANT_NOT_FOUND", variantId });
});

test("saves a new sale with payments and short stock and opens the order", async () => {
  const paymentId = "00000000-0000-4000-8000-000000000005";
  const create = vi.spyOn(composition, "createConfiguredOrder").mockResolvedValue({ success: true, data: { order: { id: orderId }, stockDue: { kind: "waiting", shortItems: [{ variantId: input.items[0].variantId, available: 3 }] } } } as never);
  const response = await save({ id: orderId, items: [{ variantId: input.items[0].variantId, quantity: 4 }],
    payments: [{ paymentId, amount: { amount: 120, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] });
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).headers.get("location")).toBe(`http://localhost/es-PE/orders/${orderId}`);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ payments: [expect.objectContaining({ paymentId, amount: { amount: 120, currency: "PEN" } })] }), { companyId, userId: "seller" });
});

test("a delivery saved on a waiting order says so and the new-sale note promises the wait", () => {
  expect(deliverySavedKey({ stockDue: { kind: "waiting", shortItems: [{ variantId: orderId, available: 0 }] } })).toBe("orderDelivery.savedWaiting");
  for (const stockDue of [null, { kind: "deducting" } as const]) expect(deliverySavedKey({ stockDue })).toBe("orderDelivery.saved");
  expect(resources.es.translation.orderDelivery.savedWaiting).toBe("Entrega guardada. El pedido queda esperando stock.");
  expect(resources.es.translation.orders.stockWarning.replace("{{stock}}", "3")).toBe("Disponible: 3. Si lo cobras, el pedido quedará esperando stock.");
  expect(resources.pt.translation.orderDelivery.savedWaiting).toBeTruthy();
});
