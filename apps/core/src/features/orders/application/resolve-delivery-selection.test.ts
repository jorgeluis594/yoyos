import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";
import { resolveDeliverySelection, type ResolveDeliveryDependencies } from "@core/src/features/orders/application/resolve-delivery-selection";
import { parseDeliverySelection, parseDeliverySnapshot } from "@core/src/features/orders/domain/order-state-machine";

const context = { companyId: "00000000-0000-4000-8000-000000000001" as CompanyId, userId: "authenticated-seller" as UserId };
const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" as const } };
const selection = { method: "store" as const, recipient };
const point = { name: "Tienda", address: "Av. Lima 123", instructions: null };
const settings = { version: 1, home: { enabled: false }, store: { enabled: true as const, pickupPoint: point } };
const cost = { amount: 3, currency: "PEN" as const };
const dependencies = (): ResolveDeliveryDependencies => ({ getSettings: async () => ok(settings), resolveCost: async () => ok(cost) });

test("resolves store snapshot using authoritative configuration and the current seller", async () => {
  const result = await resolveDeliverySelection(selection, context, "PEN", dependencies());
  expect(result).toEqual(ok({ delivery: { ...selection, pickupPoint: point, recordedBy: { kind: "seller", userId: context.userId } }, cost }));
  if (!result.success || result.data.delivery.method !== "store") throw new Error("Expected store delivery");
  point.address = "Nueva dirección";
  recipient.name = "Nombre cambiado";
  expect(result.data.delivery.pickupPoint.address).toBe("Av. Lima 123");
  expect(result.data.delivery.recipient.name).toBe("Ana");
  point.address = "Av. Lima 123";
  recipient.name = "Ana";
  expect(await resolveDeliverySelection(selection, { ...context, userId: "second-seller" as UserId }, "PEN", dependencies()))
    .toMatchObject({ success: true, data: { delivery: { recordedBy: { kind: "seller", userId: "second-seller" } } } });
});

test("rejects absent or disabled settings without requesting a cost", async () => {
  const resolveCost = vi.fn(dependencies().resolveCost);
  for (const pickupPoint of [null, point]) {
    expect(await resolveDeliverySelection(selection, context, "PEN", {
      getSettings: async () => ok({ version: pickupPoint ? 1 : 0, home: { enabled: false }, store: { enabled: false, pickupPoint } }), resolveCost,
    })).toMatchObject({ success: false, error: { code: "DELIVERY_METHOD_DISABLED" } });
  }
  expect(resolveCost).not.toHaveBeenCalled();
});

test("propagates unavailable configuration and costs without manufacturing a zero price", async () => {
  for (const code of ["INVALID_STORED_DATA", "PERSISTENCE_UNAVAILABLE", "DELIVERY_UNAVAILABLE"] as const) {
    const failure = err({ code, message: "Controlled failure" });
    const deps = dependencies();
    expect(await resolveDeliverySelection(selection, context, "PEN", { ...deps, getSettings: async () => failure })).toEqual(failure);
    expect(await resolveDeliverySelection(selection, context, "PEN", { ...deps, resolveCost: async () => failure })).toEqual(failure);
  }
  expect(await resolveDeliverySelection(selection, context, "PEN", { ...dependencies(), resolveCost: async () => ok({ amount: 0, currency: "PEN" }) }))
    .toMatchObject({ success: true, data: { cost: { amount: 0 } } });
});

test.each([
  [{ amount: -1, currency: "PEN" as const }, "INVALID_ORDER"],
  [{ amount: NaN, currency: "PEN" as const }, "INVALID_ORDER"],
  [{ amount: 1.001, currency: "PEN" as const }, "INVALID_ORDER"],
  [{ amount: 1, currency: "USD" as const }, "CURRENCY_MISMATCH"],
])("rejects an invalid resolved cost: %j", async (value, code) => {
  expect(await resolveDeliverySelection(selection, context, "PEN", { ...dependencies(), resolveCost: async () => ok(value) }))
    .toMatchObject({ success: false, error: { code } });
});

test("rejects partial recipients, forged authority and legacy snapshots while preserving document text", () => {
  for (const value of [{ ...selection, recipient: { ...recipient, name: " " } }, { ...selection, recordedBy: { kind: "buyer" } },
    { ...selection, pickupPoint: point }, { ...selection, cost: 0 }]) expect(parseDeliverySelection(value).success).toBe(false);
  const documented = { ...selection, recipient: { ...recipient, identity: { kind: "document", documentType: "passport", document: "00-A-001" } } };
  expect(parseDeliverySelection(documented)).toMatchObject({ success: true, data: { recipient: { identity: { document: "00-A-001" } } } });
  expect(parseDeliverySelection({ ...documented, recipient: { ...recipient, identity: { kind: "document", documentType: "unknown", document: "001" } } }).success).toBe(false);
  expect(parseDeliverySnapshot({ ...selection, destination: { storeId: "legacy" } }).success).toBe(false);
  expect(parseDeliverySnapshot({ ...selection, pickupPoint: point, recordedBy: { kind: "seller" } }).success).toBe(false);
});

test("home requires its enabled flag and snapshots typed destination with optional instructions and seller authority", async () => {
  const home = { method: "home" as const, recipient, destination: { address: " Calle 123 ", district: " Lima ", instructions: null } };
  const resolveCost = vi.fn(dependencies().resolveCost);
  expect(await resolveDeliverySelection(home, context, "PEN", { ...dependencies(), resolveCost }))
    .toMatchObject({ success: false, error: { code: "DELIVERY_METHOD_DISABLED" } });
  expect(resolveCost).not.toHaveBeenCalled();
  const result = await resolveDeliverySelection(home, context, "PEN", {
    getSettings: async () => ok({ ...settings, home: { enabled: true } }), resolveCost,
  });
  expect(result).toEqual(ok({ delivery: { method: "home", recipient, destination: { address: "Calle 123", district: "Lima", instructions: null },
    recordedBy: { kind: "seller", userId: context.userId } }, cost }));
  home.destination.address = "Changed after resolution";
  expect(result).toMatchObject({ data: { delivery: { destination: { address: "Calle 123" } } } });
  for (const destination of [{ address: "Street", district: " ", instructions: null }, { address: "Street", instructions: null }]) {
    expect(parseDeliverySelection({ ...home, destination }).success).toBe(false);
  }
  expect(parseDeliverySelection({ ...home, destination: { address: "Street", district: "District", instructions: " Entrance " } }))
    .toMatchObject({ success: true, data: { destination: { instructions: "Entrance" } } });
});
