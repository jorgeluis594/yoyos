import { signIn as runSignIn } from "@mobile/features/users/application/sign-in";
import { register as runRegister } from "@mobile/features/users/application/register";
import { completeCompany as runCompleteCompany } from "@mobile/features/users/application/complete-company";
import { createCompanyApi } from "@mobile/features/companies/infrastructure/company-api";
import { restoreSession as runRestoreSession } from "@mobile/features/users/application/restore-session";
import { signOut as runSignOut } from "@mobile/features/users/application/sign-out";
import type { SignOutDependencies } from "@mobile/features/users/application/sign-out";
import { createAuthAdapter, type AuthClientBoundary, type SecureSessionStorage } from "@mobile/features/users/infrastructure/auth-adapter";
import { createAccessApi } from "@mobile/features/users/infrastructure/access-api";
import { createApiClient } from "@mobile/shared/infrastructure/api-client";

export function createAuthOperations(
  client: AuthClientBoundary,
  storage: SecureSessionStorage,
  fetcher: typeof fetch = fetch,
  coreUrl = "http://localhost:3000",
) {
  const auth = createAuthAdapter(client, storage, {
    accountVerificationUrl: `${coreUrl}/account-verified`,
    passwordResetRedirectTo: `${coreUrl}/reset-password`,
  });
  const request = createApiClient(auth, fetcher);
  const readAccess = createAccessApi(request);
  const sendCompany = createCompanyApi(request);
  const completeCompany = (input: Parameters<typeof runCompleteCompany>[0]) => runCompleteCompany(input, { createCompany: sendCompany, readAccess });
  return {
    request,
    sessionGeneration: auth.generation,
    register: (input: Parameters<typeof runRegister>[0]) => runRegister(input, { registerAccount: auth.registerAccount }),
    requestVerification: (email: string) => auth.requestVerification({ email }),
    requestPasswordReset: (email: string) => auth.requestPasswordReset({ email }),
    completeCompany,
    signIn: (input: Parameters<typeof runSignIn>[0]) => runSignIn(input, { signIn: auth.signIn, readAccess }),
    restoreSession: () => runRestoreSession({ restoreSession: auth.restoreSession, readAccess }),
    signOut: (clearPrivateState: () => void = () => {}) => {
      const dependencies: SignOutDependencies = {
        invalidatePendingOperations: auth.invalidate,
        revokeSession: auth.revokeSession,
        clearLocalSession: auth.clearLocalSession,
        clearPrivateState,
      };
      return runSignOut(dependencies);
    },
  };
}
