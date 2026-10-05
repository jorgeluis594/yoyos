import { describe, expect, it } from "vitest";
import { err, ok } from "@shared/functional";
import { initialDeliverySettings, parseDeliverySettings, type DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
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
    expect(parseDeliverySettings({ version: 0, store: invalid })).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  });

  it("normalizes required texts and accepts their exact limits", () => {
    expect(parseDeliverySettings({ version: 0, store: { enabled: true, pickupPoint: { ...point, name: " Tienda " } } })).toEqual(ok({ version: 0, store }));
    expect(parseDeliverySettings({ version: 1, store: { enabled: true, pickupPoint: {
      name: "n".repeat(120), address: "a".repeat(500), instructions: "i".repeat(1000),
    } } }).success).toBe(true);
  });

  function repository(initial: DeliverySettings | null) {
    let persisted = initial;
    const deps: SaveDeliverySettingsDependencies = {
      transaction: async (companyId, work) => { expect(companyId).toBe(context.companyId); return work(); },
      findForUpdate: async () => ok(persisted),
      save: async (_companyId, next) => { persisted = next; return ok(null); },
    };
    return { deps, read: () => persisted };
  }

  it("creates version one, rejects stale retries, and retains a disabled pickup point", async () => {
    const repo = repository(null);
    expect(await saveDeliverySettings({ expectedVersion: 0, store }, context, repo.deps)).toEqual(ok({ version: 1, store }));
    expect(await saveDeliverySettings({ expectedVersion: 0, store: { enabled: false, pickupPoint: null } }, context, repo.deps))
      .toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 1 } });
    expect(repo.read()).toEqual({ version: 1, store });
    const disabled = { enabled: false as const, pickupPoint: point };
    expect(await saveDeliverySettings({ expectedVersion: 1, store: disabled }, context, repo.deps)).toEqual(ok({ version: 2, store: disabled }));
    expect(await saveDeliverySettings({ expectedVersion: 2, store }, context, repo.deps)).toEqual(ok({ version: 3, store }));
  });

  it("propagates write failures and rejects invalid input before persistence", async () => {
    const repo = repository(null);
    const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unavailable" });
    expect(await saveDeliverySettings({ expectedVersion: 0, store }, context, { ...repo.deps, save: async () => failure })).toEqual(failure);
    for (const expectedVersion of [-1, 1.5, NaN, 2147483647]) {
      expect(await saveDeliverySettings({ expectedVersion, store }, context, repo.deps)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
    }
    expect(repo.read()).toBeNull();
  });
});
