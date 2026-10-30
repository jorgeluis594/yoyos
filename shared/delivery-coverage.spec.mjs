import { expect, test } from "vitest";
import { deliveryCoverage, eligibleCoverageAgencies } from "@shared/delivery-coverage";
import { canonicalPeruArea, getPeruProvinces, getPeruDistricts, keepCoveredPeruPlace, offeredPeruDepartments, offeredPeruDistricts,
  offeredPeruProvinces, peruDepartments, settlePeruLocation } from "@shared/peru-geography";

const home = (enabled = true) => ({ enabled, method: "home" });
const agencyOption = (agencyIds, enabled = true) => ({ enabled, method: "agency", agencyIds });
const zone = (codes, options, enabled = true) => ({ enabled, departmentCodes: [], provinceCodes: [], districtCodes: [], ...codes, options });
const agencies = (...entries) => entries.map(([id, districtCode]) => ({ id, districtCode }));
const area = (departmentCodes = [], provinceCodes = [], districtCodes = []) => ({ departmentCodes, provinceCodes, districtCodes });

test("eligible coverage agencies exclude disabled agencies, agencies of retired catalog couriers and disabled company couriers", () => {
  const input = [
    { id: "a", courierId: "c1", enabled: true, districtCode: "040101" },
    { id: "b", courierId: "c1", enabled: false, districtCode: "040102" },
    { id: "c", courierId: "c2", enabled: true, districtCode: "080101" },
    { id: "d", courierId: "c3", enabled: true, districtCode: "150101" },
  ];
  expect(eligibleCoverageAgencies(input, ["c1", "c3"])).toEqual([{ id: "a", districtCode: "040101" }, { id: "d", districtCode: "150101" }]);
  expect(eligibleCoverageAgencies(input, [])).toEqual([]);
});

test("home coverage is the union of enabled zones with an enabled home option and ignores disabled zones and options", () => {
  const zones = [
    zone({ provinceCodes: ["1501"] }, [home()]),
    zone({ districtCodes: ["150122"] }, [home()]),
    zone({ departmentCodes: ["04"] }, [home(false)]),
    zone({ departmentCodes: ["08"] }, [home()], false),
    zone({ districtCodes: ["210101"] }, [agencyOption(["a"])]),
  ];
  expect(deliveryCoverage({ zones, agencies: agencies(["a", "210101"]) }).home).toEqual(area([], ["1501"], []));
  expect(deliveryCoverage({ zones: zones.slice(2), agencies: [] }).home).toBeNull();
});

test("agency coverage of a zone over Arequipa, Cusco and Puno with agencies only in Arequipa is Arequipa", () => {
  const zones = [zone({ departmentCodes: ["04", "08", "21"] }, [agencyOption(["a"])])];
  expect(deliveryCoverage({ zones, agencies: agencies(["a", "040101"]) })).toEqual({ home: null, agency: area(["04"]) });
});

test("agency coverage of a whole department with agencies in one province offers every province of the department", () => {
  const zones = [zone({ departmentCodes: ["04"] }, [agencyOption(["a"])])];
  const { agency } = deliveryCoverage({ zones, agencies: agencies(["a", "040101"]) });
  expect(offeredPeruProvinces(agency, "04")).toEqual(getPeruProvinces("04"));
});

test("a zone covering only Cusco with agencies only in Arequipa gives no agency coverage, and one agency in Cusco gives Cusco", () => {
  const zones = [zone({ departmentCodes: ["08"] }, [agencyOption(["a"])])];
  expect(deliveryCoverage({ zones, agencies: agencies(["a", "040101"]) }).agency).toBeNull();
  expect(deliveryCoverage({ zones, agencies: agencies(["a", "040101"], ["b", "080101"]) }).agency).toBeNull();
  expect(deliveryCoverage({ zones: [zone({ departmentCodes: ["08"] }, [agencyOption(["a", "b"])])], agencies: agencies(["a", "040101"], ["b", "080101"]) }).agency)
    .toEqual(area(["08"]));
});

test("an agency option without eligible agencies gives no coverage", () => {
  const zones = [zone({ departmentCodes: ["04"] }, [agencyOption(["a"]), agencyOption([]), agencyOption(["a"], false)])];
  expect(deliveryCoverage({ zones, agencies: [] }).agency).toBeNull();
  expect(deliveryCoverage({ zones, agencies: agencies(["a", "999999"]) }).agency).toBeNull();
  expect(deliveryCoverage({ zones: [zone({ departmentCodes: ["04"] }, [agencyOption(["a"], false)])], agencies: agencies(["a", "040101"]) }).agency).toBeNull();
});

test("a store covering all of Peru for home returns 25 department codes and no expanded districts", () => {
  const zones = [zone({ departmentCodes: peruDepartments.map(department => department.code) }, [home()])];
  const { home: coverage } = deliveryCoverage({ zones, agencies: [] });
  expect(coverage.departmentCodes).toHaveLength(25);
  expect(coverage.provinceCodes).toEqual([]);
  expect(coverage.districtCodes).toEqual([]);
});

test("a zone with several qualifying options counts once per method and agency options of a zone add their departments together", () => {
  const zones = [zone({ departmentCodes: ["04", "08", "15"] }, [home(), home(), agencyOption(["a"]), agencyOption(["b"])])];
  const result = deliveryCoverage({ zones, agencies: agencies(["a", "040101"], ["b", "080101"]) });
  expect(result.agency).toEqual(area(["04", "08"]));
  expect(result.home).toEqual(area(["04", "08", "15"]));
});

const allDistricts = peruDepartments.flatMap(department => getPeruProvinces(department.code)).flatMap(province => getPeruDistricts(province.code));

function walkOffered(selection) {
  let count = 0;
  for (const department of offeredPeruDepartments(selection))
    for (const province of offeredPeruProvinces(selection, department.code))
      count += offeredPeruDistricts(selection, province.code).length;
  return count;
}

function coverageInput(districts) {
  const agencyIds = peruDepartments.map(department => `agency-${department.code}`);
  const zones = districts.map(district => zone({ districtCodes: [district.code] }, [home(), home(), agencyOption(agencyIds)]));
  return { zones, agencies: peruDepartments.map(department => ({ id: `agency-${department.code}`, districtCode: `${department.code}0101` })) };
}

function minimumMilliseconds(input) {
  const run = () => {
    const start = performance.now();
    const result = deliveryCoverage(input);
    walkOffered(result.home);
    walkOffered(result.agency);
    keepCoveredPeruPlace(result.home, { kind: "district", code: "150122" });
    settlePeruLocation(result.agency, null);
    return performance.now() - start;
  };
  run();
  run();
  return Math.min(...Array.from({ length: 5 }, run));
}

// Machine speed and load scale both sizes alike, so the ratio of their times does not depend on them: 8x the zones
// costs about 8x when linear and about 64x when quadratic. The bound sits between the two.
test("coverage of 1892 single-district zones with two home options and one agency option each, and the offered lists over it, grow linearly: 8x the zones cost under 24x the time as the minimum of 5 warmed runs", () => {
  const oneRound = coverageInput(allDistricts);
  const eightRounds = coverageInput(Array.from({ length: 8 }, () => allDistricts).flat());
  const result = deliveryCoverage(oneRound);
  expect(result.home.districtCodes).toHaveLength(1892);
  expect(result.agency.districtCodes).toHaveLength(1892);
  expect(minimumMilliseconds(eightRounds) / minimumMilliseconds(oneRound)).toBeLessThan(24);
});

test("canonical coverage output never needs a cast: it is already canonical", () => {
  const { home: coverage } = deliveryCoverage({ zones: [zone({ departmentCodes: ["04"], provinceCodes: ["0401"], districtCodes: ["040103"] }, [home()])], agencies: [] });
  expect(coverage).toEqual(canonicalPeruArea(coverage));
  expect(coverage).toEqual(area(["04"]));
});
