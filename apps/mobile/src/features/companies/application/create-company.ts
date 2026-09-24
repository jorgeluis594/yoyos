import { createCompanyRequestSchema, type CreateCompanyResponse } from "@shared/contracts/registration";
import { err, ok } from "@shared/functional";
import type { Country } from "@shared/country";
import type { Result } from "@shared/result";
import type { TransportError } from "@/shared/application/transport-error";

export type CompanyDraft = Readonly<{ name: string; country: Country }>;
export type CompanyRequestError = TransportError | Readonly<{ code: "INVALID_COMPANY"; message: string }>;
export type CreateCompany = (input: CompanyDraft) => Promise<Result<CreateCompanyResponse, CompanyRequestError>>;

export function normalizeCompanyDraft(input: CompanyDraft): Result<CompanyDraft, CompanyRequestError> {
  const parsed = createCompanyRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.name.trim().length < 1 || parsed.data.name.trim().length > 120) {
    return err({ code: "INVALID_COMPANY", message: "Company name or country is invalid" });
  }
  return ok({ name: parsed.data.name.trim(), country: parsed.data.country });
}

export async function createCompany(input: CompanyDraft, sendCompany: CreateCompany): Promise<Result<CreateCompanyResponse, CompanyRequestError>> {
  const draft = normalizeCompanyDraft(input);
  return draft.success ? sendCompany(draft.data) : draft;
}
