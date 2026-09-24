import type { CompanyDto, CurrentAccessDto } from "@shared/contracts/registration";

export type AccessUser = Readonly<{ id: string; name: string; companyId: string | null }>;
export type Company = CompanyDto;
export type UserAccess =
  | Readonly<{ status: "company_required"; user: AccessUser & Readonly<{ companyId: null }>; company: null }>
  | Readonly<{ status: "ready"; user: AccessUser & Readonly<{ companyId: string }>; company: Company }>;
export type ReadyAccess = Extract<UserAccess, { status: "ready" }>;

export function toUserAccess(dto: CurrentAccessDto): UserAccess {
  return dto.status === "ready"
    ? { status: "ready", user: dto.user, company: dto.company }
    : { status: "company_required", user: dto.user, company: null };
}
