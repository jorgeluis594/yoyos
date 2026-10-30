import { canonicalPeruArea, peruCodesWithinDepartments, peruDepartmentOfDistrict, type PeruAreaSelection } from "@shared/peru-geography";

/** Zone as core, web and mobile already have it; the contract shape is enough. */
export type CoverageZone = Readonly<{
  enabled: boolean; departmentCodes: readonly string[]; provinceCodes: readonly string[]; districtCodes: readonly string[];
  options: readonly (Readonly<{ enabled: boolean; method: "home" }> | Readonly<{ enabled: boolean; method: "agency"; agencyIds: readonly string[] }>)[];
}>;
/** Agency as each caller has it, with every catalog state already folded into `enabled`. */
export type CoverageAgencyInput = Readonly<{ id: string; courierId: string; enabled: boolean; districtCode: string }>;
export type CoverageAgency = Readonly<{ id: string; districtCode: string }>;
/** `null` means the method covers no place; it is never an empty selection. */
export type DeliveryCoverage = Readonly<{ home: PeruAreaSelection | null; agency: PeruAreaSelection | null }>;

/** The only eligibility rule for coverage: enabled agency (catalog agency and catalog courier) and enabled company courier. */
export function eligibleCoverageAgencies(agencies: readonly CoverageAgencyInput[], enabledCourierIds: readonly string[]): readonly CoverageAgency[] {
  const couriers = new Set(enabledCourierIds);
  return agencies.filter(agency => agency.enabled && couriers.has(agency.courierId)).map(({ id, districtCode }) => ({ id, districtCode }));
}

type Collector = { departmentCodes: string[]; provinceCodes: string[]; districtCodes: string[] };
const collector = (): Collector => ({ departmentCodes: [], provinceCodes: [], districtCodes: [] });
const addCodes = (target: Collector, codes: Readonly<{ departmentCodes: Iterable<string>; provinceCodes: Iterable<string>; districtCodes: Iterable<string> }>) => {
  for (const code of codes.departmentCodes) target.departmentCodes.push(code);
  for (const code of codes.provinceCodes) target.provinceCodes.push(code);
  for (const code of codes.districtCodes) target.districtCodes.push(code);
};
const orNull = (area: PeruAreaSelection): PeruAreaSelection | null =>
  area.departmentCodes.length + area.provinceCodes.length + area.districtCodes.length > 0 ? area : null;

/**
 * Places each method covers, ignoring the method switches. Linear in the codes of the zones: each zone counts once per
 * method and canonicalization runs once per method. Agency coverage is bounded to the departments of the zone's eligible agencies.
 */
export function deliveryCoverage(input: Readonly<{ zones: readonly CoverageZone[]; agencies: readonly CoverageAgency[] }>): DeliveryCoverage {
  const departmentOfAgency = new Map<string, string>();
  for (const agency of input.agencies) {
    const department = peruDepartmentOfDistrict(agency.districtCode);
    if (department) departmentOfAgency.set(agency.id, department);
  }
  const home = collector();
  const agency = collector();
  const departments = new Set<string>();
  for (const zone of input.zones) {
    if (!zone.enabled) continue;
    departments.clear();
    if (zone.options.some(option => option.enabled && option.method === "home")) addCodes(home, zone);
    for (const option of zone.options) {
      if (!option.enabled || option.method !== "agency") continue;
      for (const id of option.agencyIds) {
        const department = departmentOfAgency.get(id);
        if (department) departments.add(department);
      }
    }
    if (departments.size > 0) addCodes(agency, peruCodesWithinDepartments(zone, departments));
  }
  return { home: orNull(canonicalPeruArea(home)), agency: orNull(canonicalPeruArea(agency)) };
}
