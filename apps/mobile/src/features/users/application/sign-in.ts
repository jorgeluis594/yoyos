import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { z } from "zod";
import type { AccountError, AccessError, AccessReader, MobileAuth, SignInInput } from "./contracts";
import type { UserAccess } from "./user-access";

export type SignInError = Readonly<{ code: "SIGN_IN_INTERRUPTED"; message: string }> &
  (Readonly<{ step: "credentials"; cause: AccountError }> | Readonly<{ step: "access"; cause: AccessError }>);

const signInSchema = z.object({ email: z.email(), password: z.string().min(1) });

export async function signIn(
  input: SignInInput,
  dependencies: Readonly<Pick<MobileAuth, "signIn"> & { readAccess: AccessReader }>,
): Promise<Result<UserAccess, SignInError>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return err({ code: "SIGN_IN_INTERRUPTED", message: "Invalid sign-in input", step: "credentials", cause: { code: "INVALID_INPUT", message: "Invalid sign-in input" } });
  const authenticated = await dependencies.signIn(parsed.data);
  if (!authenticated.success) return err({ code: "SIGN_IN_INTERRUPTED", message: "Sign-in failed", step: "credentials", cause: authenticated.error });
  const access = await dependencies.readAccess();
  return access.success
    ? ok(access.data)
    : err({ code: "SIGN_IN_INTERRUPTED", message: "Unable to load access", step: "access", cause: access.error });
}
