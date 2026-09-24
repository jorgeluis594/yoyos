import type { AuthClientBoundary } from "@/features/users/infrastructure/auth-adapter";
import { createAuthOperations } from "./create-auth-operations";
import { authClient } from "@/shared/infrastructure/auth-client";
import * as SecureStore from "expo-secure-store";

const authSdk: AuthClientBoundary = {
  signIn: (input) => authClient.signIn.email(input),
  getSession: () => authClient.getSession(),
  token: () => authClient.token(),
  signOut: (signal) => authClient.signOut({ fetchOptions: { signal } }),
};

const operations = createAuthOperations(authSdk, SecureStore);
export const { signIn, restoreSession, signOut } = operations;
