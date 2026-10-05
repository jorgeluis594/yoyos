import { err, ok } from "@shared/functional";
import { saveDeliverySettings } from "@mobile/features/delivery-settings/application/delivery-settings";

const draft = { expectedVersion: 0, agencyEnabled: false, couriers: [], homeEnabled: false, storeEnabled: false, pickupName: "", pickupAddress: "", pickupInstructions: "" };

test("sends a virtual empty point or a complete normalized point, retaining it when disabled", async () => {
  const save = jest.fn(async () => ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false as const, pickupPoint: null } }));
  await saveDeliverySettings(draft, save);
  expect(save).toHaveBeenLastCalledWith({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } });
  await saveDeliverySettings({ ...draft, pickupName: " Store ", pickupAddress: " Lima ", pickupInstructions: "   " }, save);
  expect(save).toHaveBeenLastCalledWith({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: { name: "Store", address: "Lima", instructions: null } } });
});

test("rejects partial points and keeps the draft and version after a conflict", async () => {
  const save = jest.fn(async () => err({ code: "DELIVERY_SETTINGS_CONFLICT" as const, message: "Changed" }));
  expect(await saveDeliverySettings({ ...draft, pickupName: "Partial" }, save)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  expect(await saveDeliverySettings({ ...draft, agencyEnabled: false, couriers: [], homeEnabled: false, storeEnabled: true }, save)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  expect(save).not.toHaveBeenCalled();
  const frozen = Object.freeze({ ...draft, agencyEnabled: false, couriers: [], homeEnabled: false, storeEnabled: true, pickupName: "Store", pickupAddress: "Lima" });
  expect(await saveDeliverySettings(frozen, save)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(save).toHaveBeenCalledTimes(1);
  expect(frozen.expectedVersion).toBe(0);
});

test("a store edit preserves the loaded home enablement in the complete settings request", async () => {
  const save = jest.fn(async () => ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false as const, pickupPoint: null } }));
  await saveDeliverySettings({ ...draft, agencyEnabled: false, couriers: [], homeEnabled: true }, save);
  expect(save).toHaveBeenCalledWith({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: null } });
});


test("new courier row keys stay local while all existing inactive couriers are sent", async () => {
  const id = "00000000-0000-4000-8000-000000000003";
  const save = jest.fn(async () => err({ code: "NETWORK_ERROR" as const, message: "Offline" }));
  await saveDeliverySettings({ ...draft, agencyEnabled: true, couriers: [{ kind: "existing", id, name: " Inactive ", enabled: false }, { kind: "new", localKey: 4, name: " New ", enabled: true }] }, save);
  expect(save).toHaveBeenCalledWith({ expectedVersion: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null }, agency: { enabled: true },
    couriers: [{ kind: "existing", id, name: "Inactive", enabled: false }, { kind: "new", name: "New", enabled: true }] });
});
