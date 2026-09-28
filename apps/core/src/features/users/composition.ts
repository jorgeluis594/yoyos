import { randomUUID } from "node:crypto";
import type { Result } from "@shared/result";
import type { EmailError } from "@core/src/shared/emails/application/send-email";
import { sendEmail } from "@core/src/shared/emails/composition";
import { emailAddressSchema, accountVerificationUrlSchema, passwordResetUrlSchema } from "@core/src/features/users/application/account-links";
import { createAccountEmails } from "@core/src/features/users/infrastructure/emails/account-emails";

const emails = createAccountEmails(sendEmail);

function observe(label: string, pending: Promise<Result<void, EmailError>>) {
  void pending.then((result) => {
    if (!result.success) console.error(`[email] ${label} failed`, { code: result.error.code });
  }).catch(() => console.error(`[email] ${label} failed`, { code: "UNEXPECTED_ERROR" }));
}

function sendVerification(to: unknown, url: unknown): void {
  const recipient = emailAddressSchema.safeParse(to);
  const link = accountVerificationUrlSchema.safeParse(url);
  if (!recipient.success || !link.success) {
    console.error("[email] verification input rejected", { code: "INVALID_EMAIL_INPUT" });
    return;
  }
  observe("verification", emails.sendVerificationEmail({ to: recipient.data, verificationUrl: link.data, idempotencyKey: `verification:${randomUUID()}` }));
}

function sendReset(to: unknown, url: unknown): void {
  const recipient = emailAddressSchema.safeParse(to);
  const link = passwordResetUrlSchema.safeParse(url);
  if (!recipient.success || !link.success) {
    console.error("[email] password reset input rejected", { code: "INVALID_EMAIL_INPUT" });
    return;
  }
  observe("password reset", emails.sendPasswordResetEmail({ to: recipient.data, resetUrl: link.data, idempotencyKey: `password-reset:${randomUUID()}` }));
}

export const accountEmails = { sendVerification, sendReset };
