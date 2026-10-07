import { peruLocations } from "@shared/data/peru-geography-2026";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type PeruDepartmentCode = string & { readonly __brand: "PeruDepartmentCode" };
export type PeruProvinceCode = string & { readonly __brand: "PeruProvinceCode" };
export type PeruDistrictCode = string & { readonly __brand: "PeruDistrictCode" };
export type PeruDepartment = Readonly<{ code: PeruDepartmentCode; name: string }>;
export type PeruProvince = Readonly<{ code: PeruProvinceCode; name: string; departmentCode: PeruDepartmentCode }>;
export type PeruDistrict = Readonly<{ code: PeruDistrictCode; name: string; provinceCode: PeruProvinceCode; departmentCode: PeruDepartmentCode }>;
export type PeruDistrictError = Readonly<{ code: "INVALID_DISTRICT"; message: string }>;

export const peruGeographyVersion = "INEI-2018-2026-2026-01-14";
export const peruDepartments: readonly PeruDepartment[] = peruLocations
  .filter(([code]) => code.endsWith("0000"))
  .map(([code, name]) => ({ code: code.slice(0, 2) as PeruDepartmentCode, name }));
const provinces: readonly PeruProvince[] = peruLocations
  .filter(([code]) => code.endsWith("00") && !code.endsWith("0000"))
  .map(([code, name]) => ({ code: code.slice(0, 4) as PeruProvinceCode, name, departmentCode: code.slice(0, 2) as PeruDepartmentCode }));
const districts = new Map<string, PeruDistrict>(peruLocations
  .filter(([code]) => !code.endsWith("00"))
  .map(([code, name]) => [code, { code: code as PeruDistrictCode, name,
    provinceCode: code.slice(0, 4) as PeruProvinceCode, departmentCode: code.slice(0, 2) as PeruDepartmentCode }]));

export function getPeruProvinces(departmentCode: PeruDepartmentCode): readonly PeruProvince[] {
  return provinces.filter(province => province.departmentCode === departmentCode);
}

export function getPeruDistricts(provinceCode: PeruProvinceCode): readonly PeruDistrict[] {
  return [...districts.values()].filter(district => district.provinceCode === provinceCode);
}

export function getPeruDistrict(code: string): PeruDistrict | null {
  return districts.get(code) ?? null;
}

export function parsePeruDistrictCode(value: unknown): Result<PeruDistrictCode, PeruDistrictError> {
  const district = typeof value === "string" ? getPeruDistrict(value) : null;
  return district ? ok(district.code) : err({ code: "INVALID_DISTRICT", message: "Select a district from the Peru catalog" });
}
