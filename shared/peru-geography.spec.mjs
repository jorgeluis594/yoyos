import { expect, test } from "vitest";
import { peruDepartments, getPeruProvinces, getPeruDistricts, getPeruDistrict, parsePeruDistrictCode } from "@shared/peru-geography";

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
