import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PeruDistrictSelect, filterPeruDistricts } from "@core/app/components/peru-district-select";
import { getPeruDistrict, getPeruDistricts } from "@shared/peru-geography";

const district = getPeruDistrict("150122");
if (!district) throw new Error("Official district missing");

test("hierarchy preselects the official department, province and district by code", () => {
  const html = renderToStaticMarkup(<PeruDistrictSelect value={district.code} onChange={() => undefined} />);
  expect(html).toContain('value="15" selected=""');
  expect(html).toContain('value="1501" selected=""');
  expect(html).toContain('value="150122" selected=""');
  expect(html).toContain("LIMA METROPOLITANA");
  expect(html).toContain("MIRAFLORES · 150122");
  expect(html).not.toContain("MIRAFLORES · 040110");
});

test("empty selection requires hierarchy and provides labelled native controls", () => {
  const html = renderToStaticMarkup(<PeruDistrictSelect value={null} onChange={() => undefined} />);
  for (const label of ["Departamento", "Provincia", "Buscar distrito", "Distrito"]) expect(html).toContain(label);
  expect((html.match(/disabled=""/g) ?? []).length).toBe(3);
  expect(html).toContain("Selecciona departamento y provincia");
  expect(html).not.toContain("MIRAFLORES · 150122");
});

test("district search ignores accents and case and supports official codes within the selected province", () => {
  const districts = getPeruDistricts(district.provinceCode);
  expect(filterPeruDistricts(districts, "  míRAflores ").map(item => item.code)).toEqual(["150122", "150133"]);
  expect(filterPeruDistricts(districts, "150122")).toEqual([district]);
  expect(filterPeruDistricts(districts, "not a district")).toEqual([]);
  expect(filterPeruDistricts(districts, "")).toEqual(districts);
});
