import { expect, test } from "vitest";
import { peruDepartments, getPeruProvinces, getPeruDistricts, getPeruDistrict, parsePeruDistrictCode, parsePeruAreaSelection, peruAreaDistricts, peruAreaIncludes, peruAreaEntries, selectPeruArea,
  canonicalPeruArea, peruCodesWithinDepartments, peruDepartmentOfDistrict, offeredPeruDepartments, offeredPeruProvinces, offeredPeruDistricts,
  keepCoveredPeruPlace, isCompletePeruLocation, settlePeruLocation } from "@shared/peru-geography";
import { peruAreaSelectionSchema } from "@shared/contracts/peru-location";

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

const loose = (departmentCodes = [], provinceCodes = [], districtCodes = []) => ({ departmentCodes, provinceCodes, districtCodes });

test("canonical area absorbs provinces and districts inside a whole department, removes duplicates and ignores unknown codes", () => {
  expect(canonicalPeruArea(loose(["04", "04", "99"], ["0401", "1501", "1501", "9999"], ["040103", "150122", "150105", "999999", "150122"])))
    .toEqual(sel(["04"], ["1501"], []));
  expect(canonicalPeruArea(loose([], ["0401"], ["040103", "080101"]))).toEqual(sel([], ["0401"], ["080101"]));
  expect(canonicalPeruArea(loose(new Set(["15"]), new Set(), new Set()))).toEqual(sel(["15"]));
});

test("codes within departments keep whole departments, provinces and loose districts of those departments and drop the rest", () => {
  const result = peruCodesWithinDepartments(loose(["04", "08"], ["0401", "2101"], ["080101", "150122", "999999"]), new Set(["04", "21"]));
  expect([...result.departmentCodes]).toEqual(["04"]);
  expect([...result.provinceCodes]).toEqual(["0401", "2101"]);
  expect([...result.districtCodes]).toEqual([]);
  const districts = peruCodesWithinDepartments(loose([], [], ["080101", "040101"]), new Set(["04"]));
  expect([...districts.districtCodes]).toEqual(["040101"]);
});

test("department of a district comes from the catalog and is null for an unknown code", () => {
  expect(peruDepartmentOfDistrict("040110")).toBe("04");
  expect(peruDepartmentOfDistrict("150122")).toBe("15");
  expect(peruDepartmentOfDistrict("999999")).toBeNull();
  expect(peruDepartmentOfDistrict("1501")).toBeNull();
});

test("offered lists show only covered departments, provinces and districts, and a whole department lists all its provinces", () => {
  const area = canonicalPeruArea(loose(["04"], [], ["150122", "150105", "080101"]));
  expect(offeredPeruDepartments(area).map(value => value.code)).toEqual(["04", "08", "15"]);
  expect(offeredPeruProvinces(area, "04")).toEqual(getPeruProvinces("04"));
  expect(offeredPeruProvinces(area, "15").map(value => value.code)).toEqual(["1501"]);
  expect(offeredPeruProvinces(area, "21")).toEqual([]);
  expect(offeredPeruDistricts(area, "0401")).toEqual(getPeruDistricts("0401"));
  expect(offeredPeruDistricts(area, "1501").map(value => value.code)).toEqual(["150105", "150122"]);
  const province = canonicalPeruArea(loose([], ["1501"], []));
  expect(offeredPeruDistricts(province, "1501")).toEqual(getPeruDistricts("1501"));
  expect(offeredPeruDistricts(province, "1502")).toEqual([]);
});

test("keeping a covered place walks up from district to province to department and returns null when none is covered", () => {
  const area = canonicalPeruArea(loose([], [], ["150122", "150105"]));
  expect(keepCoveredPeruPlace(area, { kind: "district", code: "150122" })).toEqual({ kind: "district", code: "150122" });
  expect(keepCoveredPeruPlace(area, { kind: "district", code: "150101" })).toEqual({ kind: "province", code: "1501" });
  expect(keepCoveredPeruPlace(area, { kind: "district", code: "150701" })).toEqual({ kind: "department", code: "15" });
  expect(keepCoveredPeruPlace(area, { kind: "district", code: "040101" })).toBeNull();
  expect(keepCoveredPeruPlace(area, { kind: "province", code: "1502" })).toEqual({ kind: "department", code: "15" });
  expect(keepCoveredPeruPlace(area, { kind: "department", code: "04" })).toBeNull();
  const whole = canonicalPeruArea(loose(["04"]));
  expect(keepCoveredPeruPlace(whole, { kind: "district", code: "040103" })).toEqual({ kind: "district", code: "040103" });
  expect(isCompletePeruLocation({ kind: "district", code: "040103" })).toBe(true);
  expect(isCompletePeruLocation({ kind: "province", code: "0401" })).toBe(false);
});

test("settling a location fills every level with a single offered choice and stops at the first level with several", () => {
  expect(settlePeruLocation(canonicalPeruArea(loose([], [], ["150122"])), null))
    .toEqual({ location: { kind: "district", code: "150122" }, filled: "complete" });
  expect(settlePeruLocation(canonicalPeruArea(loose(["15"])), null))
    .toEqual({ location: { kind: "department", code: "15" }, filled: "partial" });
  expect(settlePeruLocation(canonicalPeruArea(loose(["04", "08"])), null)).toEqual({ location: null, filled: "none" });
  expect(settlePeruLocation(canonicalPeruArea(loose([], [], ["150122", "080101"])), null)).toEqual({ location: null, filled: "none" });
});

test("settling keeps the levels already chosen and fills only below them", () => {
  const area = canonicalPeruArea(loose([], ["1501"], ["080101"]));
  expect(settlePeruLocation(area, { kind: "department", code: "08" }))
    .toEqual({ location: { kind: "district", code: "080101" }, filled: "complete" });
  expect(settlePeruLocation(area, { kind: "department", code: "15" }))
    .toEqual({ location: { kind: "province", code: "1501" }, filled: "partial" });
  expect(settlePeruLocation(area, { kind: "district", code: "080101" })).toEqual({ location: { kind: "district", code: "080101" }, filled: "none" });
});

test("area selection contract accepts canonical catalog selections and rejects empty, unknown, non-canonical and oversized ones", () => {
  const value = sel(["04"], ["1501"], ["080101"]);
  expect(peruAreaSelectionSchema.parse(value)).toEqual(value);
  const fails = input => peruAreaSelectionSchema.safeParse(input).success === false;
  expect(fails(sel())).toBe(true);
  expect(fails(sel(["99"]))).toBe(true);
  expect(fails(sel(["15"], ["1501"]))).toBe(true);
  expect(fails(sel([], [], ["999999"]))).toBe(true);
  expect(fails(sel(Array.from({ length: 26 }, (_, index) => String(index + 1).padStart(2, "0"))))).toBe(true);
  expect(fails({ ...value, extra: 1 })).toBe(true);
});
