export const countries = ["PE", "US", "CO", "AR", "CL", "BR"] as const;

export type Country = (typeof countries)[number];

export function isCountry(value: unknown): value is Country {
  return typeof value === "string" && countries.some((country) => country === value);
}
