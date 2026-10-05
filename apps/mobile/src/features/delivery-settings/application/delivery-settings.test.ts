import { err, ok } from "@shared/functional";
import { saveDeliverySettings } from "@mobile/features/delivery-settings/application/delivery-settings";

const draft = { expectedVersion: 0, storeEnabled: false, pickupName: "", pickupAddress: "", pickupInstructions: "" };

test("sends a virtual empty point or a complete normalized point, retaining it when disabled", async () => {
  const save = jest.fn(async () => ok({ version: 1, store: { enabled: false as const, pickupPoint: null } }));
  await saveDeliverySettings(draft, save);
  expect(save).toHaveBeenLastCalledWith({ expectedVersion: 0, store: { enabled: false, pickupPoint: null } });
  await saveDeliverySettings({ ...draft, pickupName: " Store ", pickupAddress: " Lima ", pickupInstructions: "   " }, save);
  expect(save).toHaveBeenLastCalledWith({ expectedVersion: 0, store: { enabled: false, pickupPoint: { name: "Store", address: "Lima", instructions: null } } });
});

test("rejects partial points and keeps the draft and version after a conflict", async () => {
  const save = jest.fn(async () => err({ code: "DELIVERY_SETTINGS_CONFLICT" as const, message: "Changed" }));
  expect(await saveDeliverySettings({ ...draft, pickupName: "Partial" }, save)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  expect(await saveDeliverySettings({ ...draft, storeEnabled: true }, save)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  expect(save).not.toHaveBeenCalled();
  const frozen = Object.freeze({ ...draft, storeEnabled: true, pickupName: "Store", pickupAddress: "Lima" });
  expect(await saveDeliverySettings(frozen, save)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(save).toHaveBeenCalledTimes(1);
  expect(frozen.expectedVersion).toBe(0);
});
