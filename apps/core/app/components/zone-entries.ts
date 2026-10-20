import { getPeruDistrict, peruAreaDistricts, peruAreaEntries, type PeruAreaSelection } from "@shared/peru-geography";

// Contract and form codes are plain strings; the catalog helpers validate them against the catalog.
type CodeLists = Readonly<{ departmentCodes: readonly string[]; provinceCodes: readonly string[]; districtCodes: readonly string[] }>;
const lowerWords = new Set(["de", "del", "la", "las", "los", "y"]);
/** Catalog names are uppercase; the product shows them capitalized. */
export const titleCase = (name: string) => name.toLocaleLowerCase("es").split(" ")
  .map((word, index) => index > 0 && lowerWords.has(word) ? word : word.charAt(0).toLocaleUpperCase("es") + word.slice(1)).join(" ");
// The catalog names province 1501 "Lima Metropolitana"; the product calls it Lima.
const provinceName = (code: string, name: string) => code === "1501" ? "Lima" : titleCase(name);

export const departmentEntry = (name: string) => `${titleCase(name)}, todos los distritos`;
export const provinceEntry = (code: string, name: string) => `${provinceName(code, name)} (provincia), todos los distritos`;
export const provinceLabel = provinceName;

/** The zone's entries in display order, separated by semicolons. */
export const zoneEntries = (zone: CodeLists) => peruAreaEntries(zone as unknown as PeruAreaSelection).map(entry =>
  entry.kind === "department" ? departmentEntry(entry.name) : entry.kind === "province" ? provinceEntry(entry.code, entry.name)
    : `${titleCase(getPeruDistrict(entry.code)?.name ?? entry.name)} · ${entry.code}`).join("; ");

type ZoneSelection = CodeLists & Readonly<{ id: string; name: string; enabled: boolean }>;
/** Districts the selection shares with each other enabled zone; disabled zones generate no rates. */
export const zoneOverlaps = (selection: CodeLists, zones: readonly ZoneSelection[], editingId: string | null) => {
  const covered = new Set(peruAreaDistricts(selection as unknown as PeruAreaSelection).map(district => district.code));
  return zones.filter(zone => zone.enabled && zone.id !== editingId)
    .map(zone => ({ name: zone.name, count: peruAreaDistricts(zone as unknown as PeruAreaSelection).filter(district => covered.has(district.code)).length }))
    .filter(overlap => overlap.count > 0);
};
