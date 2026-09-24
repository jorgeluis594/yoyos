import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { z } from "zod";
import { countrySchema } from "@shared/contracts/registration";
import { normalizeCompanyDraft, type CompanyDraft, type CompanyRequestError } from "@/features/companies";
import type { AccountError, AccessError, AccessReader, MobileAuth, RegisterAccountInput } from "./contracts";
import type { CompleteCompanyError } from "./complete-company";
import type { ReadyAccess } from "./user-access";

export type RegisterInput = Readonly<{ account: RegisterAccountInput; company: CompanyDraft }>;
export type RegistrationError = Readonly<{ code: "REGISTRATION_INTERRUPTED"; message: string }> & (
  | Readonly<{ step: "account"; recovery: "check_session_or_edit_account"; cause: AccountError }>
  | Readonly<{ step: "access"; recovery: "restore_session"; cause: AccessError }>
  | Readonly<{ step: "company"; recovery: "reload_access_then_complete_company"; cause: CompanyRequestError }>
  | Readonly<{ step: "reload"; recovery: "reload_access"; cause: AccessError }>
);

const accountSchema = z.object({ name: z.string().trim().min(1), email: z.email(), password: z.string().min(8).max(128) });
const inputSchema = z.object({ account: accountSchema, company: z.object({ name: z.string(), country: countrySchema }) });

export async function register(
  input: RegisterInput,
  dependencies: Readonly<{
    registerAccount: MobileAuth["registerAccount"];
    readAccess: AccessReader;
    completeCompany: (input: CompanyDraft) => Promise<Result<ReadyAccess, CompleteCompanyError>>;
  }>,
): Promise<Result<ReadyAccess, RegistrationError>> {
  const parsed = inputSchema.safeParse(input);
  const draft = parsed.success ? normalizeCompanyDraft(parsed.data.company) : null;
  if (!parsed.success || !draft?.success) return err({
    code: "REGISTRATION_INTERRUPTED", message: "Invalid registration input", step: "account",
    recovery: "check_session_or_edit_account", cause: { code: "INVALID_INPUT", message: "Invalid registration input" },
  });
  const account = await dependencies.registerAccount(parsed.data.account);
  if (!account.success) return err({ code: "REGISTRATION_INTERRUPTED", message: "Unable to register account", step: "account", recovery: "check_session_or_edit_account", cause: account.error });
  const access = await dependencies.readAccess();
  if (!access.success) return err({ code: "REGISTRATION_INTERRUPTED", message: "Unable to load access", step: "access", recovery: "restore_session", cause: access.error });
  if (access.data.status === "ready") return ok(access.data);
  const completed = await dependencies.completeCompany(draft.data);
  if (completed.success) return completed;
  return completed.error.step === "create"
    ? err({ code: "REGISTRATION_INTERRUPTED", message: "Unable to create company", step: "company", recovery: "reload_access_then_complete_company", cause: completed.error.cause })
    : err({ code: "REGISTRATION_INTERRUPTED", message: "Unable to reload access", step: "reload", recovery: "reload_access", cause: completed.error.cause });
}
