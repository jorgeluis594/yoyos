import { peruLocations } from "@shared/data/peru-geography-2026";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type PeruDepartmentCode = string & { readonly __brand: "PeruDepartmentCode" };
export type PeruProvinceCode = string & { readonly __brand: "PeruProvinceCode" };
export type PeruDistrictCode = string & { readonly __brand: "PeruDistrictCode" };
export type PeruDepartment = Readonly<{ code: PeruDepartmentCode; name: string }>;
export type PeruProvince = Readonly<{ code: PeruProvinceCode; name: string; departmentCode: PeruDepartmentCode }>;
export type PeruDistrict = Readonly<{ code: PeruDistrictCode; name: string; provinceCode: PeruProvinceCode; departmentCode: PeruDepartmentCode }>;
export type PeruAreaSelection = Readonly<{
  departmentCodes: readonly PeruDepartmentCode[];
  provinceCodes: readonly PeruProvinceCode[];
  districtCodes: readonly PeruDistrictCode[];
}>;
export type PeruArea =
  | Readonly<{ kind: "department"; code: PeruDepartmentCode }>
  | Readonly<{ kind: "province"; code: PeruProvinceCode }>
  | Readonly<{ kind: "district"; code: PeruDistrictCode }>;
export type PeruAreaSelectionError = Readonly<{
  code: "INVALID_AREA_SELECTION"; message: string;
  field: "departmentCodes" | "provinceCodes" | "districtCodes";
  reason: "empty" | "unknown" | "duplicate" | "covered";
}>;
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

export function getPeruDepartment(code: string): PeruDepartment | null {
  return peruDepartments.find(department => department.code === code) ?? null;
}

export function getPeruProvince(code: string): PeruProvince | null {
  return provinces.find(province => province.code === code) ?? null;
}

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

export function filterPeruDistricts(districts: readonly PeruDistrict[], query: string): readonly PeruDistrict[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").trim();
  const term = normalize(query);
  return districts.filter(district => normalize(district.name).includes(term) || district.code.includes(term));
}

/** Catalog names of a district and its province and department, as stored in delivery locations. */
export function peruDeliveryDistrict(code: PeruDistrictCode) {
  const district = getPeruDistrict(code);
  const department = district && peruDepartments.find(value => value.code === district.departmentCode);
  const province = district && getPeruProvinces(district.departmentCode).find(value => value.code === district.provinceCode);
  if (!district || !department || !province) return null;
  return { country: "PE" as const, districtCode: district.code, district: district.name, province: province.name, department: department.name };
}

/** Validates codes against the catalog and the canonical rules: non-empty, no duplicates, no entry inside a complete parent. */
export function parsePeruAreaSelection(value: unknown): Result<PeruAreaSelection, PeruAreaSelectionError> {
  const fail = (field: PeruAreaSelectionError["field"], reason: PeruAreaSelectionError["reason"]) =>
    err<PeruAreaSelectionError>({ code: "INVALID_AREA_SELECTION", field, reason, message: `Invalid ${field}: ${reason}` });
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const codes = (field: PeruAreaSelectionError["field"]) => Array.isArray(source[field]) ? source[field] as unknown[] : null;
  const departments = codes("departmentCodes");
  const provinceCodes = codes("provinceCodes");
  const districtCodes = codes("districtCodes");
  if (!departments) return fail("departmentCodes", "unknown");
  if (!provinceCodes) return fail("provinceCodes", "unknown");
  if (!districtCodes) return fail("districtCodes", "unknown");
  if (departments.length + provinceCodes.length + districtCodes.length === 0) return fail("districtCodes", "empty");
  if (departments.some(code => typeof code !== "string" || !getPeruDepartment(code))) return fail("departmentCodes", "unknown");
  if (new Set(departments).size !== departments.length) return fail("departmentCodes", "duplicate");
  const completeDepartments = new Set<unknown>(departments);
  const provinceList = provinceCodes.map(code => typeof code === "string" ? getPeruProvince(code) : null);
  if (provinceList.some(province => !province)) return fail("provinceCodes", "unknown");
  if (new Set(provinceCodes).size !== provinceCodes.length) return fail("provinceCodes", "duplicate");
  if (provinceList.some(province => completeDepartments.has(province!.departmentCode))) return fail("provinceCodes", "covered");
  const completeProvinces = new Set<unknown>(provinceCodes);
  const districtList = districtCodes.map(code => typeof code === "string" ? getPeruDistrict(code) : null);
  if (districtList.some(district => !district)) return fail("districtCodes", "unknown");
  if (new Set(districtCodes).size !== districtCodes.length) return fail("districtCodes", "duplicate");
  if (districtList.some(district => completeDepartments.has(district!.departmentCode) || completeProvinces.has(district!.provinceCode)))
    return fail("districtCodes", "covered");
  return ok({ departmentCodes: departments as PeruDepartmentCode[], provinceCodes: provinceCodes as PeruProvinceCode[], districtCodes: districtCodes as PeruDistrictCode[] });
}

export function peruAreaIncludes(selection: PeruAreaSelection, district: PeruDistrict): boolean {
  return selection.departmentCodes.includes(district.departmentCode) || selection.provinceCodes.includes(district.provinceCode)
    || selection.districtCodes.includes(district.code);
}

/** Every catalog district the selection covers, in catalog order; used to count and to intersect. */
export function peruAreaDistricts(selection: PeruAreaSelection): readonly PeruDistrict[] {
  return [...districts.values()].filter(district => peruAreaIncludes(selection, district));
}

/** Adds an area absorbing the entries it covers, or removes it with every entry inside it. */
export function selectPeruArea(selection: PeruAreaSelection, area: PeruArea, selected: boolean): PeruAreaSelection {
  const departmentOf = (province: PeruProvinceCode) => getPeruProvince(province)?.departmentCode;
  const inside = (candidate: PeruArea): boolean => {
    if (area.kind === "district") return candidate.kind === "district" && candidate.code === area.code;
    if (area.kind === "province") {
      if (candidate.kind === "department") return false;
      return candidate.kind === "province" ? candidate.code === area.code : getPeruDistrict(candidate.code)?.provinceCode === area.code;
    }
    if (candidate.kind === "department") return candidate.code === area.code;
    return (candidate.kind === "province" ? departmentOf(candidate.code) : getPeruDistrict(candidate.code)?.departmentCode) === area.code;
  };
  const kept = {
    departmentCodes: selection.departmentCodes.filter(code => !inside({ kind: "department", code })),
    provinceCodes: selection.provinceCodes.filter(code => !inside({ kind: "province", code })),
    districtCodes: selection.districtCodes.filter(code => !inside({ kind: "district", code })),
  };
  if (!selected) return kept;
  const district = area.kind === "district" ? getPeruDistrict(area.code) : null;
  const province = area.kind === "province" ? getPeruProvince(area.code) : null;
  const covered = (district && (selection.departmentCodes.includes(district.departmentCode) || selection.provinceCodes.includes(district.provinceCode)))
    || (province && selection.departmentCodes.includes(province.departmentCode));
  if (covered) return selection;
  return area.kind === "department" ? { ...kept, departmentCodes: [...kept.departmentCodes, area.code] }
    : area.kind === "province" ? { ...kept, provinceCodes: [...kept.provinceCodes, area.code] }
    : { ...kept, districtCodes: [...kept.districtCodes, area.code] };
}

/** Display order: departments, provinces, districts, each by name. */
export function peruAreaEntries(selection: PeruAreaSelection): readonly (PeruArea & Readonly<{ name: string }>)[] {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");
  return [
    ...selection.departmentCodes.map(code => ({ kind: "department" as const, code, name: getPeruDepartment(code)?.name ?? code })).sort(byName),
    ...selection.provinceCodes.map(code => ({ kind: "province" as const, code, name: getPeruProvince(code)?.name ?? code })).sort(byName),
    ...selection.districtCodes.map(code => ({ kind: "district" as const, code, name: getPeruDistrict(code)?.name ?? code })).sort(byName),
  ];
}

const provincesByDepartment = new Map<string, PeruProvince[]>();
for (const province of provinces) {
  const list = provincesByDepartment.get(province.departmentCode);
  if (list) list.push(province); else provincesByDepartment.set(province.departmentCode, [province]);
}
const districtsByProvince = new Map<string, PeruDistrict[]>();
for (const district of districts.values()) {
  const list = districtsByProvince.get(district.provinceCode);
  if (list) list.push(district); else districtsByProvince.set(district.provinceCode, [district]);
}
const departmentCodeSet: ReadonlySet<string> = new Set(peruDepartments.map(department => department.code));
const provinceByCode = new Map<string, PeruProvince>(provinces.map(province => [province.code, province]));

/** Codes as callers hold them (core zones, contract zones); nothing is assumed to be canonical or in the catalog. */
export type LoosePeruCodes = Readonly<{
  departmentCodes: Iterable<string>; provinceCodes: Iterable<string>; districtCodes: Iterable<string>;
}>;

/** The district's department, or null when the district is not in the catalog. */
export function peruDepartmentOfDistrict(code: string): PeruDepartmentCode | null {
  return districts.get(code)?.departmentCode ?? null;
}

/** Keeps the entries whose department is in `departments`; unknown codes are dropped. */
export function peruCodesWithinDepartments(codes: LoosePeruCodes, departments: ReadonlySet<string>): LoosePeruCodes {
  const departmentCodes: string[] = [];
  const provinceCodes: string[] = [];
  const districtCodes: string[] = [];
  for (const code of codes.departmentCodes) if (departmentCodeSet.has(code) && departments.has(code)) departmentCodes.push(code);
  for (const code of codes.provinceCodes) if (provinceByCode.has(code) && departments.has(code.slice(0, 2))) provinceCodes.push(code);
  for (const code of codes.districtCodes) if (districts.has(code) && departments.has(code.slice(0, 2))) districtCodes.push(code);
  return { departmentCodes, provinceCodes, districtCodes };
}

/** Drops unknown codes and duplicates and removes every entry inside a whole parent; linear in the codes received. */
export function canonicalPeruArea(codes: LoosePeruCodes): PeruAreaSelection {
  const departmentSet = new Set<string>();
  for (const code of codes.departmentCodes) if (departmentCodeSet.has(code)) departmentSet.add(code);
  const provinceSet = new Set<string>();
  for (const code of codes.provinceCodes) if (provinceByCode.has(code) && !departmentSet.has(code.slice(0, 2))) provinceSet.add(code);
  const districtSet = new Set<string>();
  for (const code of codes.districtCodes) {
    if (districts.has(code) && !departmentSet.has(code.slice(0, 2)) && !provinceSet.has(code.slice(0, 4))) districtSet.add(code);
  }
  const sorted = (set: Set<string>) => [...set].sort();
  return {
    departmentCodes: sorted(departmentSet) as PeruDepartmentCode[],
    provinceCodes: sorted(provinceSet) as PeruProvinceCode[],
    districtCodes: sorted(districtSet) as PeruDistrictCode[],
  };
}

type AreaSets = Readonly<{
  departments: ReadonlySet<string>; provinces: ReadonlySet<string>; districts: ReadonlySet<string>;
  touchedDepartments: ReadonlySet<string>; touchedProvinces: ReadonlySet<string>;
}>;
const areaSetsCache = new WeakMap<PeruAreaSelection, AreaSets>();

/** Sets built once per area object, so every later check is O(1) even in unmemoized event handlers. */
function areaSets(area: PeruAreaSelection): AreaSets {
  const cached = areaSetsCache.get(area);
  if (cached) return cached;
  const departments = new Set<string>(area.departmentCodes);
  const provinceSet = new Set<string>(area.provinceCodes);
  const districtSet = new Set<string>(area.districtCodes);
  const touchedDepartments = new Set<string>(departments);
  const touchedProvinces = new Set<string>(provinceSet);
  for (const code of provinceSet) touchedDepartments.add(code.slice(0, 2));
  for (const code of districtSet) { touchedDepartments.add(code.slice(0, 2)); touchedProvinces.add(code.slice(0, 4)); }
  for (const department of departments) for (const province of provincesByDepartment.get(department) ?? []) touchedProvinces.add(province.code);
  const sets = { departments, provinces: provinceSet, districts: districtSet, touchedDepartments, touchedProvinces };
  areaSetsCache.set(area, sets);
  return sets;
}

/** Departments with at least one covered district, in catalog order. */
export function offeredPeruDepartments(area: PeruAreaSelection): readonly PeruDepartment[] {
  const { touchedDepartments } = areaSets(area);
  return peruDepartments.filter(department => touchedDepartments.has(department.code));
}

/** Provinces of a department with at least one covered district, in catalog order. */
export function offeredPeruProvinces(area: PeruAreaSelection, departmentCode: string): readonly PeruProvince[] {
  const { touchedProvinces } = areaSets(area);
  return (provincesByDepartment.get(departmentCode) ?? []).filter(province => touchedProvinces.has(province.code));
}

/** Covered districts of a province, in catalog order. */
export function offeredPeruDistricts(area: PeruAreaSelection, provinceCode: string): readonly PeruDistrict[] {
  const { departments, provinces: provinceSet, districts: districtSet } = areaSets(area);
  const whole = provinceSet.has(provinceCode) || departments.has(provinceCode.slice(0, 2));
  return (districtsByProvince.get(provinceCode) ?? []).filter(district => whole || districtSet.has(district.code));
}

/** Walks up from `place` (itself, then each parent) and returns the first place the area covers, or null. */
export function keepCoveredPeruPlace(area: PeruAreaSelection, place: PeruArea): PeruArea | null {
  const { departments, provinces: provinceSet, districts: districtSet, touchedDepartments, touchedProvinces } = areaSets(area);
  if (place.kind === "district") {
    if (districtSet.has(place.code) || provinceSet.has(place.code.slice(0, 4)) || departments.has(place.code.slice(0, 2))) return place;
    return keepCoveredPeruPlace(area, { kind: "province", code: place.code.slice(0, 4) as PeruProvinceCode });
  }
  if (place.kind === "province") {
    if (touchedProvinces.has(place.code)) return place;
    return keepCoveredPeruPlace(area, { kind: "department", code: place.code.slice(0, 2) as PeruDepartmentCode });
  }
  return touchedDepartments.has(place.code) ? place : null;
}

/** True when the place is at the last level of the hierarchy (district). */
export function isCompletePeruLocation(place: PeruArea): boolean {
  return place.kind === "district";
}

/** Below the deepest level set, fills each level with a single offered choice, top-down, and stops at the first with several. */
export function settlePeruLocation(area: PeruAreaSelection, location: PeruArea | null):
  Readonly<{ location: PeruArea | null; filled: "none" | "partial" | "complete" }> {
  let current = location;
  let filled = false;
  for (;;) {
    const next: PeruArea | null | undefined =
      current === null ? single(offeredPeruDepartments(area), "department")
      : current.kind === "department" ? single(offeredPeruProvinces(area, current.code), "province")
      : current.kind === "province" ? single(offeredPeruDistricts(area, current.code), "district")
      : null;
    if (!next) break;
    current = next;
    filled = true;
  }
  return { location: current, filled: !filled ? "none" : current && isCompletePeruLocation(current) ? "complete" : "partial" };
}

function single(options: readonly { code: string }[], kind: PeruArea["kind"]): PeruArea | null {
  return options.length === 1 ? { kind, code: options[0]!.code } as PeruArea : null;
}
