import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Company } from "@core/src/features/companies";
import type { User } from "@core/src/features/users/domain/user";

export type AccessUser = Readonly<Pick<User, "id" | "name">>;
export type UserAccess =
  | Readonly<{ status: "verification_required"; user: AccessUser & Readonly<{ emailVerified: false; companyId: null }>; company: null }>
  | Readonly<{ status: "company_required"; user: AccessUser & Readonly<{ emailVerified: true; companyId: null }>; company: null }>
  | Readonly<{ status: "ready"; user: AccessUser & Readonly<{ emailVerified: true; companyId: string }>; company: Readonly<Company> }>;
export type VerifiedAccess = Exclude<UserAccess, { status: "verification_required" }>;
export type ReadyAccess = Extract<UserAccess, { status: "ready" }>;
export type VerifiedAccountError = Readonly<{ code: "EMAIL_VERIFICATION_REQUIRED"; message: string }>;
export type CompanyRequiredError = Readonly<{ code: "COMPANY_REQUIRED"; message: string }>;

export function requireVerifiedAccount(access: UserAccess): Result<VerifiedAccess, VerifiedAccountError> {
  return access.status === "verification_required"
    ? err({ code: "EMAIL_VERIFICATION_REQUIRED", message: "Email verification required" })
    : ok(access);
}

export function requireCompany(access: UserAccess): Result<ReadyAccess, CompanyRequiredError | VerifiedAccountError> {
  const verified = requireVerifiedAccount(access);
  if (!verified.success) return verified;
  return verified.data.status === "ready" ? ok(verified.data) : err({ code: "COMPANY_REQUIRED", message: "Company required" });
}
