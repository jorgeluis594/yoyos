import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { initialDeliverySettings, parseDeliverySettings, type DeliverySettings, type CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { getDeliverySettings, saveDeliverySettings, type SaveDeliverySettingsDependencies } from "@core/src/features/delivery-settings/application/delivery-settings";

const context = { companyId: "company", userId: "seller" };
const point = { name: "Tienda", address: "Av. Lima 123", instructions: null };
const store = { enabled: true as const, pickupPoint: point };

describe("store delivery configuration", () => {
  it("returns virtual version zero without writing and preserves read failures", async () => {
    expect(await getDeliverySettings(context, async () => ok(null))).toEqual(ok(initialDeliverySettings()));
    const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unavailable" });
    expect(await getDeliverySettings(context, async () => failure)).toEqual(failure);
  });

  it.each([
    { enabled: true, pickupPoint: null },
    { enabled: false, pickupPoint: { name: "Tienda", address: " " } },
    { enabled: true, pickupPoint: { ...point, name: " " } },
    { enabled: true, pickupPoint: { ...point, address: "a".repeat(501) } },
    { enabled: false, pickupPoint: { instructions: "Puerta azul" } },
  ])("rejects incomplete or invalid configuration: %j", (invalid) => {
    expect(parseDeliverySettings({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: invalid })).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  });

  it("normalizes required texts and accepts their exact limits", () => {
    expect(parseDeliverySettings({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { ...point, name: " Tienda " } } })).toEqual(ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }));
    expect(parseDeliverySettings({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: {
      name: "n".repeat(120), address: "a".repeat(500), instructions: "i".repeat(1000),
    } } }).success).toBe(true);
  });

  function repository(initial: DeliverySettings | null) {
    let persisted = initial;
    const deps: SaveDeliverySettingsDependencies = {
      generateCourierId: () => "00000000-0000-4000-8000-000000000003" as CourierId,
      transaction: async (companyId, work) => { expect(companyId).toBe(context.companyId); return work(); },
      findForUpdate: async () => ok(persisted),
      save: async (_companyId, next) => { persisted = next; return ok(null); },
    };
    return { deps, read: () => persisted };
  }

  it("creates version one, rejects stale retries, and retains a disabled pickup point", async () => {
    const repo = repository(null);
    expect(await saveDeliverySettings({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, context, repo.deps)).toEqual(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }));
    expect(await saveDeliverySettings({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }, context, repo.deps))
      .toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 1 } });
    expect(repo.read()).toEqual({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store });
    const disabled = { enabled: false as const, pickupPoint: point };
    expect(await saveDeliverySettings({ expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: disabled }, context, repo.deps)).toEqual(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: disabled }));
    expect(await saveDeliverySettings({ expectedVersion: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, context, repo.deps)).toEqual(ok({ version: 3, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }));
  });

  it("propagates write failures and rejects invalid input before persistence", async () => {
    const repo = repository(null);
    const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unavailable" });
    expect(await saveDeliverySettings({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, context, { ...repo.deps, save: async () => failure })).toEqual(failure);
    for (const expectedVersion of [-1, 1.5, NaN, 2147483647]) {
      expect(await saveDeliverySettings({ expectedVersion, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, context, repo.deps)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
    }
    expect(repo.read()).toBeNull();
  });
});

it("home enablement changes independently without losing the retained pickup point", async () => {
  let persisted: DeliverySettings = { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store };
  const deps: SaveDeliverySettingsDependencies = {
    generateCourierId: () => "00000000-0000-4000-8000-000000000003" as CourierId,
    transaction: async (_companyId, work) => work(), findForUpdate: async () => ok(persisted),
    save: async (_companyId, next) => { persisted = next; return ok(null); },
  };
  expect(await saveDeliverySettings({ expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store }, context, deps))
    .toEqual(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: true }, store }));
  const disabled = { enabled: false as const, pickupPoint: point };
  expect(await saveDeliverySettings({ expectedVersion: 2, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: disabled }, context, deps))
    .toEqual(ok({ version: 3, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: disabled }));
  expect(parseDeliverySettings({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: "true" }, store }).success).toBe(false);
});


it("saves courier edits and server IDs under the settings lock; a stale retry never generates IDs", async () => {
  const id = "00000000-0000-4000-8000-000000000003" as CourierId;
  let persisted: DeliverySettings | null = null;
  const generateCourierId = vi.fn(() => id);
  const deps: SaveDeliverySettingsDependencies = {
    generateCourierId, transaction: async (_companyId, work) => work(), findForUpdate: async () => ok(persisted),
    save: async (_companyId, next) => { persisted = next; return ok(null); },
  };
  const input = { expectedVersion: 0, home: { enabled: false }, store, agency: { enabled: true }, couriers: [{ kind: "new" as const, name: " Courier ", enabled: true }] };
  expect(await saveDeliverySettings(input, context, deps)).toMatchObject({ success: true, data: { version: 1, agency: { enabled: true }, couriers: [{ id, name: "Courier", enabled: true }] } });
  expect(await saveDeliverySettings(input, context, deps)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(generateCourierId).toHaveBeenCalledOnce();
  const edit = { ...input, expectedVersion: 1, couriers: [{ kind: "existing" as const, id, name: "Renamed", enabled: false }] };
  expect(await saveDeliverySettings(edit, context, deps)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  expect(await saveDeliverySettings({ ...edit, agency: { enabled: false } }, context, deps))
    .toMatchObject({ success: true, data: { version: 2, agency: { enabled: false }, couriers: [{ id, name: "Renamed", enabled: false }] } });
  expect(await saveDeliverySettings({ ...edit, expectedVersion: 2, agency: { enabled: false }, couriers: [] }, context, deps)).toMatchObject({ success: false });
  expect(persisted).toMatchObject({ version: 2, couriers: [{ id }] });
});
