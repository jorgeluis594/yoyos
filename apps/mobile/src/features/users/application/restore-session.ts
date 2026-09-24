import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { AccessError, AccessReader, MobileAuth } from "./contracts";
import type { UserAccess } from "./user-access";

export async function restoreSession(
  dependencies: Readonly<Pick<MobileAuth, "restoreSession"> & { readAccess: AccessReader }>,
): Promise<Result<UserAccess | null, AccessError>> {
  const session = await dependencies.restoreSession();
  if (!session.success) return session;
  if (session.data === "absent") return ok(null);
  const access = await dependencies.readAccess();
  if (!access.success && access.error.code === "UNAUTHENTICATED") return ok(null);
  return access;
}
