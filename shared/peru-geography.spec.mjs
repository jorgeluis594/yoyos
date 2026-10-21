import { expect, test } from "vitest";
import { peruDepartments, getPeruProvinces, getPeruDistricts, getPeruDistrict, parsePeruDistrictCode, parsePeruAreaSelection, peruAreaDistricts, peruAreaIncludes, peruAreaEntries, selectPeruArea } from "@shared/peru-geography";

test("official catalog preserves every geographic level, unique district and parent relationship", () => {
  const provinces = peruDepartments.flatMap(department => getPeruProvinces(department.code));
  const districts = provinces.flatMap(province => getPeruDistricts(province.code));
  expect(peruDepartments).toHaveLength(25);
  expect(provinces).toHaveLength(196);
  expect(districts).toHaveLength(1892);
  expect(new Set(districts.map(district => district.code)).size).toBe(1892);
  for (const district of districts) {
    expect(district.code).toMatch(/^\d{6}$/);
    expect(district.provinceCode).toBe(district.code.slice(0, 4));
    expect(district.departmentCode).toBe(district.code.slice(0, 2));
    expect(district.name).not.toMatch(/\d|\//);
  }
});

test("district lookup distinguishes identical names across provinces and keeps leading zeroes", () => {
  expect(getPeruDistrict("150122")).toEqual({ code: "150122", name: "MIRAFLORES", provinceCode: "1501", departmentCode: "15" });
  expect(getPeruDistrict("040110")).toEqual({ code: "040110", name: "MIRAFLORES", provinceCode: "0401", departmentCode: "04" });
  expect(getPeruDistrict("010101")?.name).toBe("CHACHAPOYAS");
});

test("unknown codes, numeric codes and department or province codes are not valid districts", () => {
  expect(parsePeruDistrictCode("150122")).toEqual({ success: true, data: "150122" });
  for (const value of [null, undefined, 150122, "", "999999", "150100", "150000", "15", "1501", " 150122", "Miraflores"]) {
    expect(parsePeruDistrictCode(value)).toMatchObject({ success: false, error: { code: "INVALID_DISTRICT" } });
  }
});

const sel = (departmentCodes = [], provinceCodes = [], districtCodes = []) => ({ departmentCodes, provinceCodes, districtCodes });

test("parsePeruAreaSelection accepts departments, provinces and loose districts together", () => {
  const value = sel(["04"], ["1501"], ["080101"]);
  expect(parsePeruAreaSelection(value)).toEqual({ success: true, data: value });
});

test("parsePeruAreaSelection rejects an empty selection", () => {
  expect(parsePeruAreaSelection(sel())).toMatchObject({ success: false, error: { field: "districtCodes", reason: "empty" } });
});

test("parsePeruAreaSelection rejects unknown and duplicate department and province codes", () => {
  expect(parsePeruAreaSelection(sel(["99"]))).toMatchObject({ error: { field: "departmentCodes", reason: "unknown" } });
  expect(parsePeruAreaSelection(sel(["04", "04"]))).toMatchObject({ error: { field: "departmentCodes", reason: "duplicate" } });
  expect(parsePeruAreaSelection(sel([], ["9999"]))).toMatchObject({ error: { field: "provinceCodes", reason: "unknown" } });
  expect(parsePeruAreaSelection(sel([], ["1501", "1501"]))).toMatchObject({ error: { field: "provinceCodes", reason: "duplicate" } });
});

test("parsePeruAreaSelection rejects a province inside a complete department and a district inside a complete province", () => {
  expect(parsePeruAreaSelection(sel(["04"], ["0401"]))).toMatchObject({ error: { field: "provinceCodes", reason: "covered" } });
  expect(parsePeruAreaSelection(sel([], ["0401"], ["040103"]))).toMatchObject({ error: { field: "districtCodes", reason: "covered" } });
  expect(parsePeruAreaSelection(sel(["04"], [], ["040103"]))).toMatchObject({ error: { field: "districtCodes", reason: "covered" } });
});

test("peruAreaDistricts counts 225 districts for Arequipa and Cusco complete", () => {
  expect(peruAreaDistricts(sel(["04"]))).toHaveLength(109);
  expect(peruAreaDistricts(sel(["08"]))).toHaveLength(116);
  expect(peruAreaDistricts(sel(["04", "08"]))).toHaveLength(225);
});

test("peruAreaIncludes covers Cayma through its department and Miraflores through its province, not Huaral", () => {
  expect(peruAreaIncludes(sel(["04"]), getPeruDistrict("040103"))).toBe(true);
  expect(peruAreaIncludes(sel([], ["1501"]), getPeruDistrict("150122"))).toBe(true);
  expect(peruAreaIncludes(sel([], ["1501"]), getPeruDistrict("150601"))).toBe(false);
  expect(peruAreaIncludes(sel(["04"]), getPeruDistrict("150122"))).toBe(false);
});

test("selectPeruArea absorbs loose Cayma when Arequipa is marked and does not restore it when unmarked", () => {
  const marked = selectPeruArea(sel([], [], ["040103", "150122"]), { kind: "department", code: "04" }, true);
  expect(marked).toEqual(sel(["04"], [], ["150122"]));
  expect(selectPeruArea(marked, { kind: "department", code: "04" }, false)).toEqual(sel([], [], ["150122"]));
  expect(selectPeruArea(sel(["04"]), { kind: "province", code: "0401" }, true)).toEqual(sel(["04"]));
});

test("peruAreaEntries orders departments, then provinces, then districts by name", () => {
  const entries = peruAreaEntries(sel(["08", "04"], ["1501"], ["150131", "150122"]));
  expect(entries.map(entry => entry.name)).toEqual(["AREQUIPA", "CUSCO", "LIMA METROPOLITANA", "MIRAFLORES", "SAN ISIDRO"]);
});

test("parsePeruDistrictCode still rejects province and department codes", () => {
  expect(parsePeruDistrictCode("1501")).toMatchObject({ success: false });
  expect(parsePeruDistrictCode("04")).toMatchObject({ success: false });
});
