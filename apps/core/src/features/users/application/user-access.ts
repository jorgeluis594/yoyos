import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Company } from "@core/src/features/companies";
import type { User } from "@core/src/features/users/domain/user";

export type AccessUser = Readonly<Pick<User, "id" | "name">>;
export type UserAccess =
  | Readonly<{ status: "company_required"; user: AccessUser & Readonly<{ companyId: null }>; company: null }>
  | Readonly<{ status: "ready"; user: AccessUser & Readonly<{ companyId: string }>; company: Readonly<Company> }>;
export type ReadyAccess = Extract<UserAccess, { status: "ready" }>;
export type CompanyRequiredError = Readonly<{ code: "COMPANY_REQUIRED"; message: string }>;

export function requireCompany(access: UserAccess): Result<ReadyAccess, CompanyRequiredError> {
  return access.status === "ready" ? ok(access) : err({ code: "COMPANY_REQUIRED", message: "Company required" });
}
