import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Company } from "@core/src/features/companies";
import type { User } from "@core/src/features/users/domain/user";
import type { UserAccess } from "@core/src/features/users/application/user-access";
import { z } from "zod";

export type AccessLoadError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA" | "UNEXPECTED_ERROR";
  message: string;
}>;
export type AccessUserRecord = Readonly<Pick<User, "id" | "name" | "companyId">>;
export type LoadUserAccessDependencies = Readonly<{
  findUser: (userId: string) => Promise<Result<AccessUserRecord | null, AccessLoadError>>;
  findCompany: (companyId: string) => Promise<Result<Readonly<Company> | null, AccessLoadError>>;
}>;

export async function loadUserAccess(
  userId: string,
  dependencies: LoadUserAccessDependencies,
): Promise<Result<UserAccess | null, AccessLoadError>> {
  const userResult = await dependencies.findUser(userId);
  if (!userResult.success) return userResult;
  const user = userResult.data;
  if (!user) return ok(null);
  if (!user.id || typeof user.name !== "string" || user.companyId !== null && !z.uuid().safeParse(user.companyId).success) {
    return err({ code: "INVALID_STORED_DATA", message: "Invalid stored user" });
  }
  if (!user.companyId) return ok({ status: "company_required", user: { id: user.id, name: user.name, companyId: null }, company: null });
  const companyResult = await dependencies.findCompany(user.companyId);
  if (!companyResult.success) return companyResult;
  const company = companyResult.data;
  if (!company || company.id !== user.companyId) return err({ code: "INVALID_STORED_DATA", message: "Linked company is unavailable" });
  return ok({ status: "ready", user: { id: user.id, name: user.name, companyId: user.companyId }, company });
}
