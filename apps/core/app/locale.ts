import { isCountry, type Country } from "@shared/country";

export type Language = "es" | "pt";

export function isLocale(value: string): boolean {
  return /^(es|pt)-/.test(value) && isCountry(value.slice(3));
}

export function languageFromPath(path: string): Language {
  const segment = path.split("/")[1] ?? "";
  return isLocale(segment) && segment.startsWith("pt-") ? "pt" : "es";
}

export function localePrefix(path: string): string {
  const segment = path.split("/")[1] ?? "";
  return isLocale(segment) ? `/${segment}` : "";
}

export function companyLocale(path: string, country: Country): string {
  return `${languageFromPath(path)}-${country}`;
}
