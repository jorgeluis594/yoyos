import { isCountry } from "@shared/country";

export function isLocale(value: string): boolean {
  return value === "pt-BR" || (value.startsWith("es-") && isCountry(value.slice(3)));
}

export function languageForLocale(locale: string): "es" | "pt" {
  return locale === "pt-BR" ? "pt" : "es";
}

export function localizedPath(pathname: string, target: string): string {
  const segment = pathname.split("/")[1];
  return `${isLocale(segment) ? `/${segment}` : ""}${target}`;
}

export function companyPath(pathname: string, country: string, target: string): string {
  return `/${pathname.split("/")[1] === "pt-BR" ? "pt-BR" : `es-${country}`}${target}`;
}
