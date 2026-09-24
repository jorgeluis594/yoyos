import { signIn as runSignIn } from "@/features/users/application/sign-in";
import { register as runRegister } from "@/features/users/application/register";
import { completeCompany as runCompleteCompany } from "@/features/users/application/complete-company";
import { createCompanyApi } from "@/features/companies/infrastructure/company-api";
import { restoreSession as runRestoreSession } from "@/features/users/application/restore-session";
import { signOut as runSignOut } from "@/features/users/application/sign-out";
import type { SignOutDependencies } from "@/features/users/application/sign-out";
import { createAuthAdapter, type AuthClientBoundary, type SecureSessionStorage } from "@/features/users/infrastructure/auth-adapter";
import { createAccessApi } from "@/features/users/infrastructure/access-api";
import { createApiClient } from "@/shared/infrastructure/api-client";

export function createAuthOperations(
  client: AuthClientBoundary,
  storage: SecureSessionStorage,
  fetcher: typeof fetch = fetch,
) {
  const auth = createAuthAdapter(client, storage);
  const request = createApiClient(auth, fetcher);
  const readAccess = createAccessApi(request);
  const sendCompany = createCompanyApi(request);
  const completeCompany = (input: Parameters<typeof runCompleteCompany>[0]) => runCompleteCompany(input, { createCompany: sendCompany, readAccess });
  return {
    register: (input: Parameters<typeof runRegister>[0]) => runRegister(input, { registerAccount: auth.registerAccount, readAccess, completeCompany }),
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
