import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { expect, test } from "vitest";
import { PeruDistrictMultiSelect } from "@core/app/components/peru-district-multi-select";
import { getPeruDistrict } from "@shared/peru-geography";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const withI18n = (element: React.ReactElement) => <I18nextProvider i18n={i18n}>{element}</I18nextProvider>;

const lima = getPeruDistrict("150122");
const arequipa = getPeruDistrict("040110");
if (!lima || !arequipa) throw new Error("Official districts missing");

test("selection lists names once and names the province only for districts outside the current one", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={[lima.code, arequipa.code]} onChange={() => undefined} />));
  expect(html).toContain("2 distritos seleccionados");
  expect(html).toContain(": MIRAFLORES, MIRAFLORES (AREQUIPA)");
  expect(html).toContain('value="1501" selected=""');
});

test("empty coverage requires hierarchy before searching districts", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={[]} onChange={() => undefined} />));
  expect(html).toContain("0 distritos seleccionados");
  expect(html).toContain('placeholder="Selecciona departamento y provincia');
  expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled=""/);
});

test("disabled coverage disables the native fieldset", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictMultiSelect value={[lima.code]} onChange={() => undefined} disabled />));
  expect(html).toContain('<fieldset disabled=""');
});
