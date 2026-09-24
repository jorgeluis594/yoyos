import { signIn as runSignIn } from "@/features/users/application/sign-in";
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
  return {
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
