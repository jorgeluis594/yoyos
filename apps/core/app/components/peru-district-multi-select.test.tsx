import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { expect, test } from "vitest";
import { PeruDistrictMultiSelect } from "@core/app/components/peru-district-multi-select";
import { getPeruDistrict, selectPeruArea, type PeruAreaSelection } from "@shared/peru-geography";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const withI18n = (element: React.ReactElement) => <I18nextProvider i18n={i18n}>{element}</I18nextProvider>;

const none: PeruAreaSelection = { departmentCodes: [], provinceCodes: [], districtCodes: [] };
const lima = getPeruDistrict("150122");
const arequipa = getPeruDistrict("040110");
if (!lima || !arequipa) throw new Error("Official districts missing");

test("selection lists names once and shows loose districts with their code and selects the province of the first one", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={{ ...none, districtCodes: [lima.code, arequipa.code] }} onChange={() => undefined} />));
  expect(html).toContain("2 distritos seleccionados");
  expect(html).toContain(": Miraflores · 150122; Miraflores · 040110");
  expect(html).toContain('value="1501" selected=""');
});

test("empty coverage requires hierarchy before searching districts", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={none} onChange={() => undefined} />));
  expect(html).toContain("0 distritos seleccionados");
  expect(html).toContain('placeholder="Selecciona departamento y provincia');
  expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled=""/);
});

test("disabled coverage disables the native fieldset", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={{ ...none, districtCodes: [lima.code] }} onChange={() => undefined} disabled />));
  expect(html).toContain('<fieldset disabled=""');
});

test("a complete department summarises as one entry, disables province and districts and never lists its districts", () => {
  const value = selectPeruArea(selectPeruArea(none, { kind: "department", code: "04" as never }, true), { kind: "department", code: "08" as never }, true);
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={value} onChange={() => undefined} />));
  expect(html).toContain("225 distritos seleccionados");
  expect(html).toContain(": Arequipa, todos los distritos; Cusco, todos los distritos");
  expect(html).toContain("Arequipa ya está completo en la zona.");
  expect(html).toContain("Todos los distritos de Arequipa");
  expect(html).toMatch(/<select[^>]*disabled=""[^>]*>\s*<option value="" selected="">Selecciona una provincia/);
  expect(html).not.toContain("CAYMA");
});

test("a complete province shows its entry and the province note", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={{ ...none, provinceCodes: ["1501" as never] }} onChange={() => undefined} />));
  expect(html).toContain(": Lima (provincia), todos los distritos");
  expect(html).toContain("Lima (provincia) ya está completa en la zona.");
  expect(html).toContain("Todos los distritos de la provincia Lima");
});
