import type { Currency } from "./money.js";

export const countries = ["PE", "US", "CO", "AR", "CL", "BR"] as const;

export type Country = (typeof countries)[number];

export const countryCurrencies: Readonly<Record<Country, Currency>> = {
  PE: "PEN", US: "USD", CO: "COP", AR: "ARS", CL: "CLP", BR: "BRL",
};

export function isCountry(value: unknown): value is Country {
  return typeof value === "string" && countries.some((country) => country === value);
}
