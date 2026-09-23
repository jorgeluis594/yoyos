import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type Company = {
  id: string;
  name: string;
};

export type CompanyInput = {
  id?: string;
  name: string;
};

export type CompanyError = {
  message: string;
  code: "INVALID_COMPANY";
};

export function validateCompany(input: CompanyInput): Result<null, CompanyError> {
  if (!input || (input.id !== undefined && (typeof input.id !== "string" || !input.id.trim())) ||
      typeof input.name !== "string" || !input.name.trim()) {
    return err({ message: "Company requires a name and a nonempty ID when provided", code: "INVALID_COMPANY" });
  }
  return ok(null);
}
