import { register } from "@core/src/features/users/application/register";
import { createCompanyAdapter, createRegisterAccountAdapter } from "@core/src/features/users/infrastructure/register-adapters";
import { authClient } from "@core/src/shared/infrastructure/auth-client";

export const createCompanyForCurrentUser = createCompanyAdapter(fetch);

export const registerWeb = (input: Parameters<typeof register>[0], callbackPath = "/account-verified") => register(input, {
  registerAccount: createRegisterAccountAdapter((account) => authClient.signUp.email({ ...account, callbackURL: `${window.location.origin}${callbackPath}` })),
});
