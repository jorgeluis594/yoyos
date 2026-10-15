import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { prepareCouriers, type Courier, type CourierCatalogEntry, type CourierCatalogId, type CourierCode, type CourierId, type CourierInput } from "@core/src/features/delivery-settings/domain/delivery-settings";

const id = "00000000-0000-4000-8000-000000000001" as CourierId;
const newId = "00000000-0000-4000-8000-000000000002" as CourierId;
const shalomId = "00000000-0000-4000-8000-000000000101" as CourierCatalogId;
const olvaId = "00000000-0000-4000-8000-000000000102" as CourierCatalogId;
const catalog: readonly CourierCatalogEntry[] = [{ id: shalomId, code: "shalom" as CourierCode, name: "Shalom" }, { id: olvaId, code: "olva" as CourierCode, name: "Olva Courier" }];
const current: readonly Courier[] = [{ id, catalogId: shalomId, name: "Shalom", enabled: false, catalogEnabled: true }];
const retained: CourierInput = { kind: "existing", id, enabled: false };
const added: CourierInput = { kind: "new", catalogId: olvaId, enabled: true };

test("new courier takes the catalog name and a server ID; existing couriers keep identity and only change enablement", () => {
  const generateId = vi.fn(() => newId);
  expect(prepareCouriers({ couriers: [{ ...retained, enabled: true }, added] }, current, catalog, generateId))
    .toEqual(ok([{ ...current[0], enabled: true }, { id: newId, catalogId: olvaId, name: "Olva Courier", enabled: true, catalogEnabled: true }]));
  expect(generateId).toHaveBeenCalledOnce();
  expect(current[0]).toMatchObject({ enabled: false });
});

test("existing courier omission, repeated IDs and unknown or foreign IDs fail before generating new IDs", () => {
  const generateId = vi.fn(() => newId);
  for (const couriers of [[], [retained, retained], [{ ...retained, id: newId }]]) {
    expect(prepareCouriers({ couriers }, current, catalog, generateId)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  }
  expect(generateId).not.toHaveBeenCalled();
});

test("a courier outside the enabled catalog or already configured cannot be added", () => {
  const unknown: CourierInput = { kind: "new", catalogId: "00000000-0000-4000-8000-000000000199" as CourierCatalogId, enabled: true };
  const duplicated: CourierInput = { kind: "new", catalogId: shalomId, enabled: true };
  for (const couriers of [[retained, unknown], [retained, duplicated], [retained, added, added]]) {
    expect(prepareCouriers({ couriers }, current, catalog, () => newId).success).toBe(false);
  }
  // A courier disabled in the catalog is absent from the enabled catalog read.
  expect(prepareCouriers({ couriers: [retained, added] }, current, [catalog[0]], () => newId).success).toBe(false);
  // Existing couriers whose catalog entry was later disabled are retained and can only be disabled.
  const delisted: readonly Courier[] = [{ ...current[0], catalogEnabled: false }];
  expect(prepareCouriers({ couriers: [retained] }, delisted, [], () => newId)).toEqual(ok(delisted));
});

test("agency delivery may be offered without enabled couriers: options without eligible agencies are simply not quoted", () => {
  expect(prepareCouriers({ couriers: [retained] }, current, catalog, () => newId)).toEqual(ok(current));
  expect(prepareCouriers({ couriers: [] }, [], catalog, () => newId)).toEqual(ok([]));
});

test("unknown fields, names supplied by the client, supplied new IDs and invalid IDs are rejected", () => {
  expect(prepareCouriers({ couriers: [added] }, [], catalog, () => newId).success).toBe(true);
  for (const value of [{ ...added, name: "Forged" }, { ...added, id: newId }, { ...added, enabled: "true" }, { ...added, catalogId: "invalid" },
    { ...added, kind: "unknown" }, { ...retained, id: "invalid" }, { ...retained, name: "Forged" }]) {
    expect(prepareCouriers({ couriers: [value as CourierInput] }, [], catalog, () => newId).success).toBe(false);
  }
  expect(prepareCouriers({ couriers: [retained, { ...added, enabled: "x" } as unknown as CourierInput] }, current, catalog, () => id).success).toBe(false);
});
