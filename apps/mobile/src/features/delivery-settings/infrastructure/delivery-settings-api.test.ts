import { err, ok } from "@shared/functional";
import type { SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";

const input = { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true as const, pickupPoint: { name: " Store ", address: " Lima ", instructions: null } } };

test("validates absent settings and rejects corrupt or incomplete remote settings", async () => {
  const request = jest.fn(async () => ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
  expect(await createDeliverySettingsApi(request).get()).toMatchObject({ success: true, data: { version: 0 } });
  expect(request).toHaveBeenCalledWith("/api/delivery-settings");
  for (const invalid of [{ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: null } }, { version: -1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }, {}]) {
    expect(await createDeliverySettingsApi(async () => ok(invalid)).get()).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  }
});

test("sends only normalized complete settings and requires the next saved version", async () => {
  const request = jest.fn<ReturnType<Parameters<typeof createDeliverySettingsApi>[0]>, Parameters<Parameters<typeof createDeliverySettingsApi>[0]>>(async () => ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } }));
  const api = createDeliverySettingsApi(request);
  expect(await api.save({ ...input, companyId: "forged" } as SaveDeliverySettingsRequest)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(request).not.toHaveBeenCalled();
  expect(await api.save(input)).toMatchObject({ success: true, data: { version: 1 } });
  expect(request).toHaveBeenCalledWith("/api/delivery-settings", { method: "PUT", headers: { "content-type": "application/json" },
    body: expect.any(String) });
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } });
  expect(await createDeliverySettingsApi(async () => ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } })).save(input))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("preserves save conflicts without retry and checks error status and operation", async () => {
  const request = jest.fn(async () => err({ code: "API_ERROR" as const, message: "Failed", http: { status: 409, body: { code: "DELIVERY_SETTINGS_CONFLICT", error: "Changed" } } }));
  const api = createDeliverySettingsApi(request);
  expect(await api.save(input)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(request).toHaveBeenCalledTimes(1);
  expect(await api.get()).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(await createDeliverySettingsApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: 400, body: { code: "DELIVERY_SETTINGS_CONFLICT", error: "Changed" } } })).save(input))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(await createDeliverySettingsApi(async () => err({ code: "NETWORK_ERROR", message: "Offline" })).get()).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
});
