import type { AuthClientBoundary } from "@mobile/features/users/infrastructure/auth-adapter";
import { createAuthOperations } from "./create-auth-operations";
import { authClient } from "@mobile/shared/infrastructure/auth-client";
import * as SecureStore from "expo-secure-store";
import { coreUrl } from "@mobile/shared/infrastructure/core-url";

const authSdk: AuthClientBoundary = {
  signUp: (input) => authClient.signUp.email(input),
  signIn: (input) => authClient.signIn.email(input),
  sendVerificationEmail: (input) => authClient.sendVerificationEmail(input),
  requestPasswordReset: (input) => authClient.requestPasswordReset(input),
  getSession: () => authClient.getSession(),
  token: () => authClient.token(),
  signOut: (signal) => authClient.signOut({ fetchOptions: { signal } }),
};

const operations = createAuthOperations(authSdk, SecureStore, fetch, coreUrl);
export const { register, completeCompany, signIn, restoreSession, signOut, request, sessionGeneration, requestVerification, requestPasswordReset } = operations;
