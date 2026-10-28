import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, loader } from "@core/app/routes/delivery-settings";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { dispatchSender } from "@core/src/features/dispatch-sender/composition";
import { log } from "@core/src/shared/infrastructure/logger";

const access = { company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" }, user: { id: "00000000-0000-4000-8000-000000000002" } };
const context = { get: () => access } as unknown as ActionFunctionArgs["context"];
const input = { expectedVersion: 0, agency: { enabled: false }, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: " Store ", address: " Lima ", instructions: null } } };
function save(body: unknown) {
  return action({ context, request: new Request("http://localhost/es-PE/settings/delivery", { method: "POST", body: JSON.stringify(body) }) } as ActionFunctionArgs);
}
afterEach(() => vi.restoreAllMocks());

test("validates the full settings body and takes company and author from the session", async () => {
  const write = vi.spyOn(deliverySettings, "save").mockResolvedValue({ success: true, data: { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } } });
  expect(await save({ ...input, companyId: "forged" })).toEqual({ error: "invalid" });
  expect(await save({ ...input, agency: { enabled: false }, home: { enabled: false }, store: { enabled: true, pickupPoint: null } })).toEqual({ error: "invalid" });
  expect(write).not.toHaveBeenCalled();
  expect(await save(input)).toMatchObject({ saved: { version: 1 } });
  expect(write).toHaveBeenCalledWith({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } }, { companyId: access.company.id, userId: access.user.id });
});

test("returns a recoverable conflict without silently retrying a stale version", async () => {
  const write = vi.spyOn(deliverySettings, "save").mockResolvedValue({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT", message: "Changed", currentVersion: 1, reason: "stale_version" } });
  expect(await save(input)).toEqual({ error: "conflict" });
  expect(write).toHaveBeenCalledOnce();
});

test("reports unexpected failures safely", async () => {
  vi.spyOn(deliverySettings, "save").mockRejectedValue(new Error("Private detail"));
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await save(input)).toEqual({ error: "saveError" });
  expect(failure).toHaveBeenCalledOnce();
  expect(failure.mock.calls[0][0]).toMatchObject({ event: "delivery_settings_request_failed", entryPoint: "web_action", operation: "save_delivery_settings", userId: access.user.id, errorCode: "INTERNAL_ERROR" });
});

const zoneInput = { intent: "zones", expectedVersion: 0, zones: [{ kind: "new", name: "Lima", enabled: true, departmentCodes: [], provinceCodes: [], districtCodes: ["150122"],
  options: [{ kind: "new", method: "home", name: "Standard", enabled: true, price: { amount: 8, currency: "PEN" } }] }] };

test("zone action validates the request and persists the complete zones with options under session authority", async () => {
  const write = vi.spyOn(deliverySettings, "saveZones").mockResolvedValue({ success: true, data: {
    version: 1, currency: "PEN", home: { enabled: false }, agency: { enabled: false }, zones: [], agencies: [],
  } });
  for (const invalid of [{ ...zoneInput, companyId: "forged" }, { ...zoneInput, intent: "other" },
    { ...zoneInput, method: "home" }, { ...zoneInput, expectedVersion: -1 },
    { ...zoneInput, zones: [{ ...zoneInput.zones[0], options: [{ kind: "new", method: "home", name: "Standard", enabled: true, price: null }] }] },
    { ...zoneInput, zones: [{ ...zoneInput.zones[0], options: [{ kind: "new", method: "home", name: "Standard", enabled: true, price: { amount: 8, currency: "PEN" }, agencyIds: [] }] }] }]) {
    expect(await save(invalid)).toEqual({ zonesError: { code: "INVALID_INPUT" } });
  }
  expect(write).not.toHaveBeenCalled();
  expect(await save(zoneInput)).toMatchObject({ zonesSaved: { version: 1 } });
  const expected = { expectedVersion: zoneInput.expectedVersion, zones: zoneInput.zones };
  expect(write).toHaveBeenCalledWith(expected, { companyId: access.company.id, userId: access.user.id });
});

test("zone conflict and validation preserve typed recovery details without retrying or exposing private messages", async () => {
  const write = vi.spyOn(deliverySettings, "saveZones").mockResolvedValue({ success: false,
    error: { code: "DELIVERY_SETTINGS_CONFLICT", message: "Private detail", currentVersion: 4, reason: "stale_version" } });
  expect(await save(zoneInput)).toEqual({ zonesError: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 4, reason: "stale_version" } });
  expect(write).toHaveBeenCalledOnce();
  write.mockResolvedValue({ success: false, error: { code: "INVALID_DELIVERY_ZONE", message: "Private detail", field: "districtCodes", index: 0 } });
  expect(await save(zoneInput)).toEqual({ zonesError: { code: "INVALID_DELIVERY_ZONE", field: "districtCodes", index: 0 } });
  write.mockResolvedValue({ success: false, error: { code: "INVALID_DELIVERY_OPTION", message: "Private detail", field: "price", index: 0, optionIndex: 1 } });
  expect(await save(zoneInput)).toEqual({ zonesError: { code: "INVALID_DELIVERY_OPTION", field: "price", index: 0, optionIndex: 1 } });
});

test("zone technical failure never returns a saved configuration", async () => {
  vi.spyOn(deliverySettings, "saveZones").mockRejectedValue(new Error("Private detail"));
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await save(zoneInput)).toEqual({ zonesError: { code: "INTERNAL_ERROR" } });
  expect(failure).toHaveBeenCalledOnce();
  expect(failure.mock.calls[0][0]).toMatchObject({ event: "delivery_zones_request_failed", operation: "save_delivery_zones", entryPoint: "web_action" });
});

test("the loader returns the sender state of the session company without touching the settings version", async () => {
  const state = { configured: { name: null, phone: "977" }, effective: { name: "Mi Negocio", phone: "977" } };
  const read = vi.spyOn(dispatchSender, "get").mockResolvedValue({ success: true, data: state });
  const settings = { version: 3, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false as const, pickupPoint: null } };
  vi.spyOn(deliverySettings, "get").mockResolvedValue({ success: true, data: settings });
  vi.spyOn(deliverySettings, "getCourierCatalog").mockResolvedValue({ success: true, data: [] });
  vi.spyOn(deliverySettings, "getZones").mockResolvedValue({ success: true, data: { version: 3, currency: "PEN", home: { enabled: false }, agency: { enabled: false }, zones: [], agencies: [] } });
  const named = { get: () => ({ ...access, company: { ...access.company, name: "Mi Negocio" } }) } as unknown as LoaderFunctionArgs["context"];
  const loaded = await loader({ context: named, request: new Request("http://localhost/es-PE/settings/delivery") } as LoaderFunctionArgs);
  expect(loaded).toMatchObject({ version: 3, sender: state, companyName: "Mi Negocio" });
  expect(read).toHaveBeenCalledWith(access.company.id);
});

test("the loader fails with 503 when the sender cannot be read instead of showing an empty card", async () => {
  vi.spyOn(dispatchSender, "get").mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "down" } });
  vi.spyOn(deliverySettings, "get").mockResolvedValue({ success: true, data: { version: 3, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false as const, pickupPoint: null } } });
  vi.spyOn(deliverySettings, "getCourierCatalog").mockResolvedValue({ success: true, data: [] });
  await expect(loader({ context, request: new Request("http://localhost/x") } as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
});
