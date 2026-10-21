import type { TFunction } from "i18next";
import { getPeruDistrict, parsePeruAreaSelection, peruAreaDistricts, peruAreaEntries, type PeruAreaSelection } from "@shared/peru-geography";

type CodeLists = Readonly<{ departmentCodes: readonly string[]; provinceCodes: readonly string[]; districtCodes: readonly string[] }>;
const lowerWords = new Set(["de", "del", "la", "las", "los", "y"]);
/** Catalog names are uppercase; the product shows them capitalized. */
export const titleCase = (name: string) => name.toLocaleLowerCase("es").split(" ")
  .map((word, index) => index > 0 && lowerWords.has(word) ? word : word.charAt(0).toLocaleUpperCase("es") + word.slice(1)).join(" ");
// The catalog names province 1501 "Lima Metropolitana"; the product calls it Lima.
const provinceName = (code: string, name: string) => code === "1501" ? "Lima" : titleCase(name);

export const provinceLabel = provinceName;

/** Contract and form codes are plain strings; parsing validates them against the catalog. An empty or invalid draft has no entries. */
export const toSelection = (lists: CodeLists): PeruAreaSelection => {
  const parsed = parsePeruAreaSelection(lists);
  return parsed.success ? parsed.data : { departmentCodes: [], provinceCodes: [], districtCodes: [] };
};

/** The zone's entries in display order, separated by semicolons. */
export const zoneEntries = (zone: CodeLists, t: TFunction) => peruAreaEntries(toSelection(zone)).map(entry =>
  entry.kind === "department" ? t("deliveryZones.entryDepartment", { name: titleCase(entry.name) })
    : entry.kind === "province" ? t("deliveryZones.entryProvince", { name: provinceName(entry.code, entry.name) })
    : `${titleCase(getPeruDistrict(entry.code)?.name ?? entry.name)} · ${entry.code}`).join("; ");

type ZoneSelection = CodeLists & Readonly<{ id: string; name: string; enabled: boolean }>;
/** Districts the selection shares with each other enabled zone; disabled zones generate no rates. */
export const zoneOverlaps = (selection: CodeLists, zones: readonly ZoneSelection[], editingId: string | null) => {
  const covered = new Set(peruAreaDistricts(toSelection(selection)).map(district => district.code));
  return zones.filter(zone => zone.enabled && zone.id !== editingId)
    .map(zone => ({ name: zone.name, count: peruAreaDistricts(toSelection(zone)).filter(district => covered.has(district.code)).length }))
    .filter(overlap => overlap.count > 0);
};
