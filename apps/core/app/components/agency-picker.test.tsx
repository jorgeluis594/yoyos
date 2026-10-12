import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";
import resources from "@core/app/locales";
import { expect, test } from "vitest";
import { filterAgencies } from "@shared/agency-search";
import { AgencyPicker, describeAgency } from "@core/app/components/agency-picker";
import { hasEligibleAgency } from "@core/app/components/delivery-zones-section";
import type { CatalogAgencyContract, DeliveryZonesResponse } from "@shared/contracts/delivery-settings";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const render = (element: React.ReactElement) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const location = (district: string) => ({ country: "PE" as const, districtCode: "150122", district, province: "Lima", department: "Lima" });
const agency = (n: number, name: string, district: string, enabled = true): CatalogAgencyContract =>
  ({ id: id(n), courierId: id(100), name, address: `Av. ${name} 1`, location: location(district), enabled });
const catalog = [agency(1, "Central", "Miraflores"), agency(2, "Norte", "Comas"), agency(3, "Ñandú", "Ate", false)];

test("agency search ignores case and accents and matches name, district and address", () => {
  expect(filterAgencies(catalog, "").map(value => value.id)).toEqual([id(1), id(2), id(3)]);
  expect(filterAgencies(catalog, "MIRAFLORES").map(value => value.id)).toEqual([id(1)]);
  expect(filterAgencies(catalog, "nandu").map(value => value.id)).toEqual([id(3)]);
  expect(filterAgencies(catalog, "av. norte").map(value => value.id)).toEqual([id(2)]);
  expect(filterAgencies(catalog, "zzz")).toEqual([]);
});

test("the picker lists selected agencies with their courier-independent details and flags inactive ones", () => {
  const html = render(<AgencyPicker id="x" couriers={[{ courierId: id(100), name: "Shalom" }]} known={catalog} value={[id(1), id(3)]} onChange={() => undefined} />);
  expect(html).toContain(describeAgency(catalog[0]));
  expect(html).toContain("Ñandú");
  expect(html).toContain("Desactivada");
  expect(html).toContain("Shalom");
  expect(render(<AgencyPicker id="x" couriers={[]} known={[]} value={[]} onChange={() => undefined} />)).toContain("Habilita un courier");
});

test("an agency option without an enabled agency of an enabled courier is flagged as not offered", () => {
  const state = { agencies: catalog } as unknown as DeliveryZonesResponse;
  const option = (...agencyIds: string[]) => ({ id: id(50), method: "agency" as const, name: "A", enabled: true, price: { amount: 1, currency: "PEN" as const }, agencyIds });
  const couriers = (enabled: boolean) => [{ id: id(60), courierId: id(100), name: "Shalom", enabled }];
  expect(hasEligibleAgency(option(id(1)), state, couriers(true))).toBe(true);
  expect(hasEligibleAgency(option(id(3)), state, couriers(true))).toBe(false);
  expect(hasEligibleAgency(option(id(1)), state, couriers(false))).toBe(false);
  expect(hasEligibleAgency(option(), state, couriers(true))).toBe(false);
});
