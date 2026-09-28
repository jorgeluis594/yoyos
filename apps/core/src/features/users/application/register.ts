import { registerAccountRequestSchema } from "@shared/contracts/account-actions";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

type Account = ReturnType<typeof registerAccountRequestSchema.parse>;
export type RegisterInput = Readonly<Account>;
export type RegisterError = Readonly<{
  code: "INVALID_INPUT" | "INVALID_RESPONSE" | "INVALID_ERROR_RESPONSE" | "REJECTED" | "NETWORK_ERROR";
  message: string;
}>;
export type RegisterDependencies = Readonly<{
  registerAccount: (account: Account) => Promise<Result<void, RegisterError>>;
}>;

export async function register(input: unknown, dependencies: RegisterDependencies): Promise<Result<Readonly<{ status: "accepted" }>, RegisterError>> {
  const account = registerAccountRequestSchema.safeParse(input);
  if (!account.success) return err({ code: "INVALID_INPUT", message: "Invalid account details" });
  const created = await dependencies.registerAccount(account.data);
  return created.success ? ok({ status: "accepted" }) : created;
}
