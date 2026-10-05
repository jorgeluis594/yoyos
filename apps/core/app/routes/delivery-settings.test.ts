import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import { action } from "@core/app/routes/delivery-settings";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { log } from "@core/src/shared/infrastructure/logger";

const access = { company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" }, user: { id: "00000000-0000-4000-8000-000000000002" } };
const context = { get: () => access } as unknown as ActionFunctionArgs["context"];
const input = { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { name: " Store ", address: " Lima ", instructions: null } } };
function save(body: unknown) {
  return action({ context, request: new Request("http://localhost/es-PE/settings/delivery", { method: "POST", body: JSON.stringify(body) }) } as ActionFunctionArgs);
}
afterEach(() => vi.restoreAllMocks());

test("validates the full settings body and takes company and author from the session", async () => {
  const write = vi.spyOn(deliverySettings, "save").mockResolvedValue({ success: true, data: { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } } });
  expect(await save({ ...input, companyId: "forged" })).toEqual({ error: "invalid" });
  expect(await save({ ...input, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: null } })).toEqual({ error: "invalid" });
  expect(write).not.toHaveBeenCalled();
  expect(await save(input)).toMatchObject({ saved: { version: 1 } });
  expect(write).toHaveBeenCalledWith({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } }, { companyId: access.company.id, userId: access.user.id });
});

test("returns a recoverable conflict without silently retrying a stale version", async () => {
  const write = vi.spyOn(deliverySettings, "save").mockResolvedValue({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT", message: "Changed", currentVersion: 1, reason: "stale_version" } });
  expect(await save(input)).toEqual({ error: "conflict" });
  expect(write).toHaveBeenCalledOnce();
});

test("reports unexpected failures safely", async () => {
  vi.spyOn(deliverySettings, "save").mockRejectedValue(new Error("Private detail"));
  vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await save(input)).toEqual({ error: "saveError" });
});
