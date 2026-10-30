import { log } from "@core/src/shared/infrastructure/logger";
import { afterEach, expect, test, vi } from "vitest";
import { action } from "@core/app/routes/order-detail";
import { orders } from "@core/src/features/orders/composition";
import { RouterContextProvider } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import type { ReadyAccess } from "@core/src/features/users";
import { err } from "@shared/functional";

const orderId = "00000000-0000-4000-8000-000000000003";
const access = { company: { id: "00000000-0000-4000-8000-000000000001" }, user: { id: "current-seller" } };
const base = "C".repeat(43);
const recipient = { name: " Ana ", phone: " 999 ", identity: { kind: "absent" } };
const pickup = { operation: "save_changes", delivery: { base, change: { kind: "replace", selection: { method: "store", recipient }, expectedPrice: { amount: 0, currency: "PEN" } } } };
const ratedSelection = { method: "home", recipient, rateId: "00000000-0000-4000-8000-000000000004", destination: { districtCode: "040110", address: " Calle QA ", instructions: null } };
const rated = { operation: "save_changes", delivery: { base, change: { kind: "replace", selection: ratedSelection, expectedPrice: { amount: 8, currency: "PEN" } } } };

async function save(body: unknown) {
  const context = new RouterContextProvider();
  context.set(privateUserContext, access as unknown as ReadyAccess);
  const request = new Request(`http://localhost/es-PE/orders/${orderId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return action({ params: { orderId }, context, request, url: new URL(request.url), pattern: "/:locale/orders/:orderId" });
}
afterEach(() => vi.restoreAllMocks());

const invalid = { operation: "save_changes", code: "INVALID_INPUT" };

test("rejects price, snapshot and authorship claims before calling the use case", async () => {
  const edit = vi.spyOn(orders, "edit");
  const change = pickup.delivery.change;
  for (const body of [{ ...pickup, cost: 0 }, { ...pickup, companyId: "forged" }, { ...pickup, delivery: { ...pickup.delivery, change: { ...change, cost: 0 } } },
    { ...pickup, delivery: { ...pickup.delivery, change: { ...change, selection: { ...change.selection, recordedBy: { kind: "buyer" } } } } },
    { ...pickup, delivery: { ...pickup.delivery, change: { ...change, selection: { ...change.selection, pickupPoint: { name: "Fake", address: "Fake", instructions: null } } } } }]) {
    expect(await save(body)).toEqual(invalid);
  }
  expect(edit).not.toHaveBeenCalled();
});

test("uses session access and an explicit reviewed pickup price, with the recipient trimmed", async () => {
  const edit = vi.spyOn(orders, "edit").mockResolvedValue(err({ code: "DELIVERY_UNAVAILABLE", message: "Unavailable" }));
  expect(await save(pickup)).toEqual({ operation: "save_changes", code: "DELIVERY_UNAVAILABLE" });
  expect(edit).toHaveBeenCalledWith({ orderId, delivery: { base, change: { kind: "replace", expectedPrice: { amount: 0, currency: "PEN" },
    selection: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } } } } }, { companyId: access.company.id, userId: access.user.id });
});

test.each(["DELIVERY_LOCKED", "ORDER_CANCELLED", "DELIVERY_METHOD_DISABLED", "RATE_UNAVAILABLE"] as const)("answers %s as its own code with no internal detail", async (code) => {
  vi.spyOn(orders, "edit").mockResolvedValue(err({ code, message: "Internal detail" }));
  expect(await save(pickup)).toEqual({ operation: "save_changes", code });
});

test("passes a reviewed rate separately from trusted seller access", async () => {
  const edit = vi.spyOn(orders, "edit").mockResolvedValue(err({ code: "RATE_UNAVAILABLE", message: "Private detail" }));
  expect(await save(rated)).toEqual({ operation: "save_changes", code: "RATE_UNAVAILABLE" });
  expect(edit).toHaveBeenCalledWith({ orderId, delivery: { base, change: { kind: "replace", expectedPrice: { amount: 8, currency: "PEN" },
    selection: { ...ratedSelection, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { ...ratedSelection.destination, address: "Calle QA" } } } } },
  { companyId: access.company.id, userId: access.user.id });
});

test("returns the current delivery price when the reviewed one is outdated and writes nothing", async () => {
  vi.spyOn(orders, "edit").mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "Private detail", currentPrice: { amount: 10, currency: "PEN" } } as never));
  expect(await save(rated)).toEqual({ operation: "save_changes", code: "TOTAL_CHANGED", currentPrice: { amount: 10, currency: "PEN" } });
});

test("rejects charge decisions, snapshot claims, a missing reviewed price and unofficial districts", async () => {
  const edit = vi.spyOn(orders, "edit");
  const change = rated.delivery.change;
  const place = (patch: object) => ({ ...rated, delivery: { ...rated.delivery, change: { ...change, selection: { ...ratedSelection, ...patch } } } });
  for (const body of [{ ...rated, obsoleteCharge: false }, place({ recordedBy: { kind: "buyer" } }), place({ destination: { ...ratedSelection.destination, districtCode: "999999" } }),
    { ...rated, delivery: { ...rated.delivery, change: { kind: "replace", selection: ratedSelection } } }]) {
    expect(await save(body)).toEqual(invalid);
  }
  expect(edit).not.toHaveBeenCalled();
});

test("unexpected action failures have one safe bounded server context and no success reply", async () => {
  vi.spyOn(orders, "edit").mockRejectedValue(new Error("Private detail"));
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await save(pickup)).toEqual({ operation: "save_changes", code: "PERSISTENCE_UNAVAILABLE" });
  expect(failure).toHaveBeenCalledOnce();
  expect(failure.mock.calls[0]![0]).toMatchObject({ event: "order_edit_request_failed", entryPoint: "web_action", operation: "edit_order", orderId, userId: access.user.id, errorCode: "INTERNAL_ERROR" });
});
