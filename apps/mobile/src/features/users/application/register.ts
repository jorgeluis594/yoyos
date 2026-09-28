import { registerAccountRequestSchema } from "@shared/contracts/account-actions";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { AccountError, MobileAuth, RegisterAccountInput } from "./contracts";

export type RegistrationError = Readonly<{ code: "REGISTRATION_FAILED"; message: string; cause: AccountError }>;
export type RegistrationAccepted = Readonly<{ status: "accepted" }>;
export type RegisterInput = RegisterAccountInput;

export async function register(
  input: RegisterAccountInput,
  dependencies: Readonly<Pick<MobileAuth, "registerAccount">>,
): Promise<Result<RegistrationAccepted, RegistrationError>> {
  const parsed = registerAccountRequestSchema.safeParse(input);
  if (!parsed.success) return err({ code: "REGISTRATION_FAILED", message: "Invalid registration input", cause: { code: "INVALID_INPUT", message: "Invalid registration input" } });
  const registered = await dependencies.registerAccount(parsed.data);
  return registered.success
    ? ok({ status: "accepted" })
    : err({ code: "REGISTRATION_FAILED", message: "Unable to register account", cause: registered.error });
}
