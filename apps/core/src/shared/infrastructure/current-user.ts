import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { loadUserAccess, type UserAccess } from "@core/src/features/users";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";
import { userRepository } from "@core/src/features/users/infrastructure/user-repository";
import { auth } from "@core/src/shared/infrastructure/auth";
import { authenticateJwt } from "@core/src/shared/infrastructure/jwt-verifier";
import type { AccessLoadError } from "@core/src/features/users/application/load-user-access";

export type AuthenticationError = Readonly<{
  code: "UNAUTHENTICATED" | "AUTH_SERVICE_UNAVAILABLE" | "UNEXPECTED_ERROR";
  message: string;
}>;
export type AuthenticatedPrincipal = Readonly<{ userId: string; sessionId: string }>;

export async function authenticateCookie(headers: Headers): Promise<Result<AuthenticatedPrincipal, AuthenticationError>> {
  try {
    const session = await auth.api.getSession({ headers });
    if (!session) return err({ code: "UNAUTHENTICATED", message: "Session required" });
    return ok({ userId: session.user.id, sessionId: session.session.id });
  } catch (cause) {
    console.error("Unable to validate session", cause);
    return err({ code: "AUTH_SERVICE_UNAVAILABLE", message: "Unable to validate session" });
  }
}

export async function resolveCurrentAccess(headers: Headers): Promise<Result<UserAccess, AuthenticationError | AccessLoadError>> {
  const authorization = headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const principal = authorization !== null
    ? match ? await authenticateJwt(match[1]) : err({ code: "UNAUTHENTICATED" as const, message: "Invalid authorization" })
    : await authenticateCookie(headers);
  if (!principal.success) return principal;
  const access = await loadUserAccess(principal.data.userId, { ...userRepository, findCompany: companyRepository.findCompany });
  if (!access.success) return access;
  if (!access.data) return err({ code: "UNAUTHENTICATED", message: "User no longer exists" });
  return ok(access.data);
}
