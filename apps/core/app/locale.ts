import { isCountry } from "@shared/country";

export function isLocale(value: string): boolean {
  return value.startsWith("es-") && isCountry(value.slice(3));
}
