import { expect, test } from "vitest";
import { parseDeliveryZone, prepareDeliveryZones, type DeliveryZoneInput } from "@core/src/features/delivery-settings/domain/delivery-zone";

const id = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const thirdId = "00000000-0000-4000-8000-000000000003";
const fields = { name: " Nearby ", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" as const } };
const home = () => {
  const parsed = parseDeliveryZone({ id, method: "home", ...fields }, "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const agency = () => {
  const parsed = parseDeliveryZone({ id: secondId, method: "agency", ...fields }, "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};

test("zones normalize names, allow districts across provinces and explicit zero prices", () => {
  expect(parseDeliveryZone({ id, method: "home", ...fields, districtCodes: ["150122", "040110"], price: { amount: 0, currency: "PEN" } }, "PEN"))
    .toMatchObject({ success: true, data: { name: "Nearby", districtCodes: ["150122", "040110"], price: { amount: 0, currency: "PEN" } } });
});

test("zone requires a name, shipping method, real unique districts and a valid business price", () => {
  const valid = { id, method: "home", ...fields };
  for (const change of [{ id: "bad" }, { method: "store" }, { name: " " }, { name: "n".repeat(121) }, { districtCodes: [] },
    { districtCodes: ["999999"] }, { districtCodes: ["150122", "150122"] }, { price: null }, { price: { amount: 8.001, currency: "PEN" } },
    { price: { amount: 8, currency: "USD" } }, { enabled: "true" }, { companyId: id }]) {
    expect(parseDeliveryZone({ ...valid, ...change }, "PEN")).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE" } });
  }
  expect(parseDeliveryZone({ ...valid, name: "n".repeat(120) }, "PEN").success).toBe(true);
});

test("overlapping home zones retain every district and independently preserve agency configuration", () => {
  const current = [home(), agency()];
  const result = prepareDeliveryZones({ method: "home", zones: [
    { kind: "existing", id, ...fields, enabled: false }, { kind: "new", ...fields, price: { amount: 12, currency: "PEN" } },
  ] }, current, "PEN", () => thirdId);
  expect(result).toMatchObject({ success: true, data: [agency(),
    { id, method: "home", enabled: false, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } },
    { id: thirdId, method: "home", enabled: true, districtCodes: ["150122"], price: { amount: 12, currency: "PEN" } },
  ] });
  expect(current).toEqual([home(), agency()]);
});

test("saved zones cannot be omitted, repeated, moved to another method or referenced by foreign identity", () => {
  const retained: DeliveryZoneInput = { kind: "existing", id, ...fields };
  for (const zones of [[], [retained, retained], [{ ...retained, id: secondId }], [{ ...retained, id: thirdId }]]) {
    expect(prepareDeliveryZones({ method: "home", zones }, [home(), agency()], "PEN", () => thirdId).success).toBe(false);
  }
});

test("validation identifies a new zone's row without inventing an ID", () => {
  expect(prepareDeliveryZones({ method: "home", zones: [{ kind: "new", ...fields, districtCodes: ["150122", "150122"] }] }, [], "PEN", () => thirdId))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE", field: "districtCodes", index: 0 } });
  expect(prepareDeliveryZones({ method: "home", zones: [{ kind: "new", ...fields, price: { amount: -1, currency: "PEN" } }] }, [], "PEN", () => thirdId))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE", field: "price", index: 0 } });
});

test("generated IDs must be valid and globally unique, including zones of the other method", () => {
  for (const generated of ["bad", id, secondId]) {
    expect(prepareDeliveryZones({ method: "home", zones: [{ kind: "existing", id, ...fields }, { kind: "new", ...fields }] },
      [home(), agency()], "PEN", () => generated).success).toBe(false);
  }
  expect(prepareDeliveryZones({ method: "home", zones: [{ kind: "new", ...fields }, { kind: "new", ...fields }] }, [], "PEN", () => thirdId).success).toBe(false);
});
