import { err, ok } from "@shared/functional";
import { isCountry, type Country } from "@shared/country";
import type { Result } from "@shared/result";

export type Company = {
  id: string;
  name: string;
  country: Country;
};

export type CompanyInput = {
  id?: string;
  name: string;
  country: Country;
};

export type CompanyError = {
  message: string;
  code: "INVALID_COMPANY";
};

export function validateCompany(input: CompanyInput): Result<null, CompanyError> {
  if (!input || (input.id !== undefined && (typeof input.id !== "string" || !input.id.trim())) ||
      typeof input.name !== "string" || !input.name.trim() || !isCountry(input.country)) {
    return err({ message: "Company requires a name, supported country and a nonempty ID when provided", code: "INVALID_COMPANY" });
  }
  return ok(null);
}
