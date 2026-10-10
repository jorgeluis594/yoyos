import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { prepareCouriers, type Courier, type CourierId, type CourierInput } from "@core/src/features/delivery-settings/domain/delivery-settings";

const id = "00000000-0000-4000-8000-000000000001" as CourierId;
const newId = "00000000-0000-4000-8000-000000000002" as CourierId;
const current: readonly Courier[] = [{ id, name: "Existing", enabled: false }];
const retained: CourierInput = { kind: "existing", id, name: " Renamed ", enabled: false };

test("new courier receives a server ID while edits retain existing IDs and normalize names", () => {
  const generateId = vi.fn(() => newId);
  expect(prepareCouriers({ agencyEnabled: true, couriers: [retained, { kind: "new", name: " New courier ", enabled: true }] }, current, generateId))
    .toEqual(ok([{ id, name: "Renamed", enabled: false }, { id: newId, name: "New courier", enabled: true }]));
  expect(generateId).toHaveBeenCalledOnce();
  expect(current).toEqual([{ id, name: "Existing", enabled: false }]);
});

test("existing courier omission, repeated IDs and unknown or foreign IDs fail before generating new IDs", () => {
  const generateId = vi.fn(() => newId);
  for (const couriers of [[], [retained, retained], [{ ...retained, id: newId }], [{ kind: "new" as const, name: "New", enabled: true }]]) {
    expect(prepareCouriers({ agencyEnabled: false, couriers }, current, generateId)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  }
  expect(generateId).not.toHaveBeenCalled();
});

test("last courier deactivation requires disabling agency in the same configuration", () => {
  expect(prepareCouriers({ agencyEnabled: true, couriers: [retained] }, current, () => newId).success).toBe(false);
  expect(prepareCouriers({ agencyEnabled: false, couriers: [retained] }, current, () => newId)).toEqual(ok([{ id, name: "Renamed", enabled: false }]));
  expect(prepareCouriers({ agencyEnabled: true, couriers: [] }, [], () => newId).success).toBe(false);
  expect(prepareCouriers({ agencyEnabled: false, couriers: [] }, [], () => newId)).toEqual(ok([]));
});

test("courier names honor exact text limits; unknown fields, supplied new IDs and invalid IDs are rejected", () => {
  const valid = { kind: "new", name: "n".repeat(120), enabled: true };
  expect(prepareCouriers({ agencyEnabled: true, couriers: [valid as CourierInput] }, [], () => newId).success).toBe(true);
  for (const value of [{ ...valid, name: " " }, { ...valid, name: "n".repeat(121) }, { ...valid, id: newId }, { ...valid, enabled: "true" },
    { ...valid, kind: "unknown" }, { ...retained, id: "invalid" }]) {
    expect(prepareCouriers({ agencyEnabled: false, couriers: [value as CourierInput] }, [], () => newId).success).toBe(false);
  }
  expect(prepareCouriers({ agencyEnabled: false, couriers: [retained, valid as CourierInput] }, current, () => id).success).toBe(false);
});
