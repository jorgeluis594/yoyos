import type { AuthClientBoundary } from "@/features/users/infrastructure/auth-adapter";
import { createAuthOperations } from "./create-auth-operations";
import { authClient } from "@/shared/infrastructure/auth-client";
import * as SecureStore from "expo-secure-store";

const authSdk: AuthClientBoundary = {
  signUp: (input) => authClient.signUp.email(input),
  signIn: (input) => authClient.signIn.email(input),
  getSession: () => authClient.getSession(),
  token: () => authClient.token(),
  signOut: (signal) => authClient.signOut({ fetchOptions: { signal } }),
};

const operations = createAuthOperations(authSdk, SecureStore);
export const { register, completeCompany, signIn, restoreSession, signOut } = operations;
