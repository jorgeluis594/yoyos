import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { initialDeliverySettings, type Courier } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import { parseDeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";
import { getCheckoutDeliveryOptions } from "@core/src/features/delivery-settings/application/get-checkout-delivery-options";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const courier = { id: id(50), catalogId: id(51), name: "Courier", enabled: true, catalogEnabled: true } as unknown as Courier;
const agency = { id: id(60), courierId: courier.catalogId, name: "Agency", address: "Street", districtCode: "150122", enabled: true, courierEnabled: true } as DeliveryAgency;
const configuration = (withAgency: boolean): DeliveryConfiguration => {
  const zone = parseDeliveryZone({ id: id(2), name: "Zone", enabled: true, districtCodes: ["150122"], options: [
    { id: id(3), method: "agency", name: "Agency", enabled: true, price: { amount: 5, currency: "PEN" }, agencyIds: [id(60)] }] }, "PEN");
  if (!zone.success) throw new Error(zone.error.message);
  return { country: "PE", currency: "PEN", settings: { ...initialDeliverySettings(), version: 4, agency: { enabled: true }, couriers: [courier] },
    zones: [zone.data], agencies: withAgency ? [agency] : [] };
};

test("checkout delivery options return settings and per-method coverage from the shared configuration read", async () => {
  for (const withAgency of [true, false]) {
    const config = configuration(withAgency);
    const result = await getCheckoutDeliveryOptions({ companyId }, { readConfigurationForShare: async id => { expect(id).toBe(companyId); return ok(config); } });
    expect(result).toEqual(ok({ settings: config.settings, coverage: { home: null,
      agency: withAgency ? { departmentCodes: [], provinceCodes: [], districtCodes: ["150122"] } : null } }));
  }
});

test("propagates an unavailable configuration read without inventing coverage", async () => {
  const failure = err({ code: "SERVICE_UNAVAILABLE" as const, message: "down" });
  expect(await getCheckoutDeliveryOptions({ companyId }, { readConfigurationForShare: async () => failure })).toEqual(failure);
});
