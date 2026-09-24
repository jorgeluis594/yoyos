import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { createCompany, type CompanyDraft, type CompanyRequestError, type CreateCompany } from "@/features/companies";
import type { AccessError, AccessReader } from "./contracts";
import type { ReadyAccess } from "./user-access";

export type CompleteCompanyError = Readonly<{ code: "COMPANY_SETUP_INTERRUPTED"; message: string }> & (
  | Readonly<{ step: "create"; cause: CompanyRequestError }>
  | Readonly<{ step: "reload"; cause: AccessError }>
);

export async function completeCompany(
  input: CompanyDraft,
  dependencies: Readonly<{ createCompany: CreateCompany; readAccess: AccessReader }>,
): Promise<Result<ReadyAccess, CompleteCompanyError>> {
  const created = await createCompany(input, dependencies.createCompany);
  if (!created.success) return err({ code: "COMPANY_SETUP_INTERRUPTED", message: "Unable to create company", step: "create", cause: created.error });
  const access = await dependencies.readAccess();
  if (!access.success) return err({ code: "COMPANY_SETUP_INTERRUPTED", message: "Unable to reload access", step: "reload", cause: access.error });
  if (access.data.status !== "ready" || access.data.company.id !== created.data.companyId) {
    return err({ code: "COMPANY_SETUP_INTERRUPTED", message: "Company access is inconsistent", step: "reload", cause: { code: "INVALID_RESPONSE", message: "Company does not match current access" } });
  }
  return ok(access.data);
}
