import { createCompanyRequestSchema } from "@shared/contracts/registration";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { z } from "zod";

const accountSchema = z.object({ name: z.string().trim().min(1), email: z.email(), password: z.string().min(8) });
type Account = z.infer<typeof accountSchema>;
type Company = z.infer<typeof createCompanyRequestSchema>;

export type RegisterInput = Readonly<{
  company: { name: string; country: string };
  account?: { name: string; email: string; password: string };
}>;
export type RegisterError = Readonly<{
  step: "account" | "company";
  code: "INVALID_INPUT" | "INVALID_RESPONSE" | "INVALID_ERROR_RESPONSE" | "REJECTED" | "NETWORK_ERROR";
  message: string;
}>;
export type RegisterDependencies = Readonly<{
  registerAccount: (account: Account) => Promise<Result<void, Omit<RegisterError, "step">>>;
  createCompany: (company: Company) => Promise<Result<void, Omit<RegisterError, "step">>>;
}>;

export async function register(input: RegisterInput, dependencies: RegisterDependencies): Promise<Result<void, RegisterError>> {
  const company = createCompanyRequestSchema.safeParse(input.company);
  if (!company.success || !company.data.name.trim() || company.data.name.trim().length > 120) {
    return err({ step: "company", code: "INVALID_INPUT", message: "Invalid company" });
  }
  const account = input.account === undefined ? null : accountSchema.safeParse(input.account);
  if (account && !account.success) return err({ step: "account", code: "INVALID_INPUT", message: "Invalid account" });

  if (account) {
    const created = await dependencies.registerAccount(account.data);
    if (!created.success) return err({ step: "account", ...created.error });
  }
  const created = await dependencies.createCompany({ ...company.data, name: company.data.name.trim() });
  return created.success ? ok(undefined) : err({ step: "company", ...created.error });
}
