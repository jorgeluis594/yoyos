import { z } from "zod";
import type { Result } from "@shared/result";
import { emailAddressSchema as accountEmailSchema } from "@shared/contracts/account-actions";
import type { EmailError } from "@core/src/shared/emails/application/send-email";

export const emailAddressSchema = accountEmailSchema.brand<"EmailAddress">();
const accountUrl = (path: string, tokenPath = false) => z.string().url().refine((value) => {
  const url = new URL(value);
  const pathMatches = tokenPath
    ? url.pathname.startsWith(path) && url.pathname.slice(path.length).length > 0 && !url.pathname.slice(path.length).includes("/")
    : url.pathname === path;
  return url.origin === new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin && pathMatches;
});
export const accountVerificationUrlSchema = accountUrl("/api/auth/verify-email").brand<"AccountVerificationUrl">();
export const passwordResetUrlSchema = accountUrl("/api/auth/reset-password/", true).brand<"PasswordResetUrl">();

export type EmailAddress = z.infer<typeof emailAddressSchema>;
export type AccountVerificationUrl = z.infer<typeof accountVerificationUrlSchema>;
export type PasswordResetUrl = z.infer<typeof passwordResetUrlSchema>;
export type SendAccountVerificationLink = (input: Readonly<{ to: EmailAddress; verificationUrl: AccountVerificationUrl; idempotencyKey: string }>) => Promise<Result<void, EmailError>>;
export type SendPasswordResetLink = (input: Readonly<{ to: EmailAddress; resetUrl: PasswordResetUrl; idempotencyKey: string }>) => Promise<Result<void, EmailError>>;
