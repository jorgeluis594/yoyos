import { register } from "@core/src/features/users/application/register";
import { createCompanyAdapter, createRegisterAccountAdapter } from "@core/src/features/users/infrastructure/register-adapters";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { localizedPath } from "@core/app/locale";

const registerAccount = createRegisterAccountAdapter((account) => authClient.signUp.email({ ...account, callbackURL: `${window.location.origin}${localizedPath(window.location.pathname, "/account-verified")}` }));
export const createCompanyForCurrentUser = createCompanyAdapter(fetch);

export const registerWeb = (input: Parameters<typeof register>[0]) => register(input, { registerAccount });
