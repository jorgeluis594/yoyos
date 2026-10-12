import type { CatalogAgencyContract } from "@shared/contracts/delivery-settings";

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").trim();

/** Agencies whose name, district, province or address contain the query, ignoring case and accents, in the given order. */
export function filterAgencies(agencies: readonly CatalogAgencyContract[], query: string): readonly CatalogAgencyContract[] {
  const term = normalize(query);
  return agencies.filter(agency => normalize(`${agency.name} ${agency.location.district} ${agency.location.province} ${agency.address}`).includes(term));
}
