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

const zoneId = "00000000-0000-4000-8000-000000000010";
const zoneInput = { method: "home" as const, expectedVersion: 0, zones: [{ kind: "new" as const, name: "Lima",
  enabled: true, districtCodes: ["150122"], price: { amount: 0, currency: "PEN" as const } }] };
const zoneState = { version: 1, currency: "PEN", home: { enabled: true }, agency: { enabled: false },
  zones: [{ id: zoneId, method: "home", name: "Lima", enabled: true, districtCodes: ["150122"], price: { amount: 0, currency: "PEN" } }] };

test("zone adapter returns definitive identities, validates the complete response and saves only a strict method request", async () => {
  const request = jest.fn<ReturnType<Parameters<typeof createDeliverySettingsApi>[0]>, Parameters<Parameters<typeof createDeliverySettingsApi>[0]>>(async () => ok(zoneState));
  const api = createDeliverySettingsApi(request);
  expect(await api.getZones()).toEqual(ok(zoneState));
  expect(await api.saveZones(zoneInput)).toEqual(ok(zoneState));
  expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual(zoneInput);
  expect(request.mock.calls[1][0]).toBe("/api/delivery-settings/zones");
  expect(request.mock.calls[1][1]?.method).toBe("PUT");
  expect(await api.saveZones({ ...zoneInput, companyId: "forged" } as typeof zoneInput)).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(request).toHaveBeenCalledTimes(2);
  for (const zone of [{ ...zoneState.zones[0], districtCodes: ["000000"] },
    { ...zoneState.zones[0], districtCodes: ["150122", "150122"] },
    { ...zoneState.zones[0], price: { amount: -1, currency: "PEN" } },
    { ...zoneState.zones[0], price: { amount: 0, currency: "USD" } }]) {
    expect(await createDeliverySettingsApi(async () => ok({ ...zoneState, zones: [zone] })).getZones()).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
  expect(await createDeliverySettingsApi(async () => ok({ ...zoneState, zones: [zoneState.zones[0], zoneState.zones[0]] })).getZones())
    .toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  expect(await createDeliverySettingsApi(async () => ok({ ...zoneState, version: 2 })).saveZones(zoneInput)).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
});

test("zone adapter preserves conflict and field details, checks HTTP status and never retries a lost response", async () => {
  const conflict = { code: "DELIVERY_SETTINGS_CONFLICT", error: "Changed", currentVersion: 2, reason: "stale_version" };
  const request = jest.fn(async () => err({ code: "API_ERROR" as const, message: "Failed", http: { status: 409, body: conflict } }));
  expect(await createDeliverySettingsApi(request).saveZones(zoneInput)).toMatchObject({
    error: { code: conflict.code, currentVersion: 2, reason: "stale_version" },
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(await createDeliverySettingsApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: 422, body: conflict } })).saveZones(zoneInput))
    .toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  expect(await createDeliverySettingsApi(async () => err({ code: "API_ERROR", message: "Failed", http: {
    status: 422, body: { code: "INVALID_DELIVERY_ZONE", error: "Invalid zone", field: "districtCodes", index: 0 },
  } })).saveZones(zoneInput)).toMatchObject({ error: { code: "INVALID_DELIVERY_ZONE", field: "districtCodes", index: 0 } });
  const offline = jest.fn(async () => err({ code: "NETWORK_ERROR" as const, message: "Offline" }));
  expect(await createDeliverySettingsApi(offline).saveZones(zoneInput)).toMatchObject({ error: { code: "NETWORK_ERROR" } });
  expect(offline).toHaveBeenCalledTimes(1);
});
