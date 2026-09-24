import { isCountry, type Country } from "@shared/country";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type CreateCompanyInput = Readonly<{ userId: string; name: string; country: Country }>;
export type CreateCompanyOutcome = Readonly<{ companyId: string; created: boolean }>;
export type CreateCompanyError = Readonly<{
  code: "INVALID_COMPANY" | "USER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA" | "UNEXPECTED_ERROR";
  message: string;
}>;
export type CompanyLink =
  | Readonly<{ status: "user_missing" }>
  | Readonly<{ status: "unlinked" }>
  | Readonly<{ status: "linked"; companyId: string }>;
export type CompanyRegistrationRepository = Readonly<{
  findLink: (userId: string) => Promise<Result<CompanyLink, CreateCompanyError>>;
  createAndLink: (input: CreateCompanyInput) => Promise<Result<
    Readonly<{ status: "created"; companyId: string }> | Readonly<{ status: "link_changed" }>,
    CreateCompanyError
  >>;
}>;

export async function createCompanyForUser(
  input: CreateCompanyInput,
  repository: CompanyRegistrationRepository,
): Promise<Result<CreateCompanyOutcome, CreateCompanyError>> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120 || !isCountry(input.country)) {
    return err({ code: "INVALID_COMPANY", message: "Company name or country is invalid" });
  }
  const link = await repository.findLink(input.userId);
  if (!link.success) return link;
  if (link.data.status === "user_missing") return err({ code: "USER_NOT_FOUND", message: "User no longer exists" });
  if (link.data.status === "linked") return ok({ companyId: link.data.companyId, created: false });

  const created = await repository.createAndLink({ ...input, name });
  if (!created.success) return created;
  if (created.data.status === "created") return ok({ companyId: created.data.companyId, created: true });

  const winner = await repository.findLink(input.userId);
  if (!winner.success) return winner;
  if (winner.data.status === "user_missing") return err({ code: "USER_NOT_FOUND", message: "User no longer exists" });
  if (winner.data.status === "unlinked") return err({ code: "INVALID_STORED_DATA", message: "Company link was lost" });
  return ok({ companyId: winner.data.companyId, created: false });
}
