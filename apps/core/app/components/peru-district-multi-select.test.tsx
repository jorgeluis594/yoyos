import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PeruDistrictMultiSelect } from "@core/app/components/peru-district-multi-select";
import { getPeruDistrict } from "@shared/peru-geography";

const lima = getPeruDistrict("150122");
const arequipa = getPeruDistrict("040110");
if (!lima || !arequipa) throw new Error("Official districts missing");

test("multiple selection retains equally named districts in different provinces with their official identity", () => {
  const html = renderToStaticMarkup(<PeruDistrictMultiSelect value={[lima.code, arequipa.code]} onChange={() => undefined} />);
  expect(html).toContain("2 distritos seleccionados");
  expect(html).toContain("MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122");
  expect(html).toContain("MIRAFLORES · AREQUIPA · AREQUIPA · 040110");
  expect(html).toContain('value="1501" selected=""');
  expect((html.match(/checked=""/g) ?? []).length).toBe(1);
  expect((html.match(/aria-label="Quitar/g) ?? []).length).toBe(2);
});

test("empty coverage requires hierarchy and never marks any district implicitly", () => {
  const html = renderToStaticMarkup(<PeruDistrictMultiSelect value={[]} onChange={() => undefined} />);
  expect(html).toContain("0 distritos seleccionados");
  expect(html).toContain("Selecciona departamento y provincia");
  expect(html).not.toContain('type="checkbox"');
  expect(html).not.toContain('aria-label="Quitar');
});

test("disabled coverage disables the native fieldset including selection and removal controls", () => {
  const html = renderToStaticMarkup(<PeruDistrictMultiSelect value={[lima.code]} onChange={() => undefined} disabled />);
  expect(html).toContain('<fieldset disabled=""');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('aria-label="Quitar MIRAFLORES');
});
