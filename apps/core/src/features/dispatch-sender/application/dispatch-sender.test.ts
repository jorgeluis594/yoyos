import { expect, test, vi } from "vitest";
import { ok, err } from "@shared/functional";
import { getDispatchSender, saveDispatchSender } from "@core/src/features/dispatch-sender/application/dispatch-sender";

const companyId = "00000000-0000-4000-8000-000000000001";
const unavailable = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });

test("reads the effective sender with the company name when nothing is configured", async () => {
  const load = vi.fn().mockResolvedValue(ok({ companyName: "Mi Negocio", sender: null }));
  expect(await getDispatchSender(companyId, { load })).toEqual(ok({ configured: { name: null, phone: null }, effective: { name: "Mi Negocio", phone: null } }));
  expect(load).toHaveBeenCalledWith(companyId);
});

test("reports a missing company and storage failures instead of falling back silently", async () => {
  expect(await getDispatchSender(companyId, { load: async () => ok(null) })).toMatchObject({ success: false, error: { code: "COMPANY_NOT_FOUND" } });
  expect(await getDispatchSender(companyId, { load: async () => unavailable })).toEqual(unavailable);
});

test("saves the trimmed sender and returns the state read back", async () => {
  const save = vi.fn().mockResolvedValue(ok(null));
  const load = vi.fn().mockResolvedValue(ok({ companyName: "Mi Negocio", sender: { name: "Fantastidog", phone: null } }));
  const result = await saveDispatchSender(companyId, { name: " Fantastidog ", phone: "  " }, { load, save });
  expect(save).toHaveBeenCalledWith(companyId, { name: "Fantastidog", phone: null });
  expect(result).toEqual(ok({ configured: { name: "Fantastidog", phone: null }, effective: { name: "Fantastidog", phone: null } }));
});

test("saving an empty name is allowed and means use the company name", async () => {
  const save = vi.fn().mockResolvedValue(ok(null));
  const load = vi.fn().mockResolvedValue(ok({ companyName: "Mi Negocio", sender: { name: null, phone: "977" } }));
  const result = await saveDispatchSender(companyId, { name: "", phone: "977" }, { load, save });
  expect(save).toHaveBeenCalledWith(companyId, { name: null, phone: "977" });
  expect(result).toMatchObject({ success: true, data: { effective: { name: "Mi Negocio", phone: "977" } } });
});

test("invalid input is rejected before touching storage and a failed save is returned", async () => {
  const save = vi.fn().mockResolvedValue(ok(null));
  const load = vi.fn();
  expect(await saveDispatchSender(companyId, { name: "n".repeat(121), phone: null }, { load, save })).toMatchObject({ success: false, error: { code: "INVALID_DISPATCH_SENDER" } });
  expect(save).not.toHaveBeenCalled();
  expect(await saveDispatchSender(companyId, { name: null, phone: null }, { load, save: async () => unavailable })).toEqual(unavailable);
  expect(load).not.toHaveBeenCalled();
});
