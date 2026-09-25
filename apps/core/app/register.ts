import { register } from "@core/src/features/users/application/register";
import { createCompanyAdapter, createRegisterAccountAdapter } from "@core/src/features/users/infrastructure/register-adapters";
import { authClient } from "@core/src/shared/infrastructure/auth-client";

const dependencies = {
  registerAccount: createRegisterAccountAdapter((account) => authClient.signUp.email(account)),
  createCompany: createCompanyAdapter(fetch),
};

export const registerWeb = (input: Parameters<typeof register>[0]) => register(input, dependencies);
