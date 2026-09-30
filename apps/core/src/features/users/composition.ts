import { randomUUID } from "node:crypto";
import type { Result } from "@shared/result";
import type { EmailError } from "@core/src/shared/emails/application/send-email";
import { sendEmail } from "@core/src/shared/emails/composition";
import { emailAddressSchema, accountVerificationUrlSchema, passwordResetUrlSchema } from "@core/src/features/users/application/account-links";
import { createAccountEmails } from "@core/src/features/users/infrastructure/emails/account-emails";
import { log } from "@core/src/shared/infrastructure/logger";

const emails = createAccountEmails(sendEmail);

function observe(label: string, pending: Promise<Result<void, EmailError>>) {
  void pending.then((result) => {
    if (!result.success) log.error({ event: `email_${label}_failed`, errorCode: result.error.code }, `email_${label}_failed`);
  }).catch((cause) => log.error({ event: `email_${label}_failed`, errorCode: "UNEXPECTED_ERROR", err: cause }, `email_${label}_failed`));
}

function sendVerification(to: unknown, url: unknown): void {
  const recipient = emailAddressSchema.safeParse(to);
  const link = accountVerificationUrlSchema.safeParse(url);
  if (!recipient.success || !link.success) {
    log.error({ event: "email_verification_input_rejected", errorCode: "INVALID_EMAIL_INPUT" }, "email_verification_input_rejected");
    return;
  }
  observe("verification", emails.sendVerificationEmail({ to: recipient.data, verificationUrl: link.data, idempotencyKey: `verification:${randomUUID()}` }));
}

function sendReset(to: unknown, url: unknown): void {
  const recipient = emailAddressSchema.safeParse(to);
  const link = passwordResetUrlSchema.safeParse(url);
  if (!recipient.success || !link.success) {
    log.error({ event: "email_password_reset_input_rejected", errorCode: "INVALID_EMAIL_INPUT" }, "email_password_reset_input_rejected");
    return;
  }
  observe("password_reset", emails.sendPasswordResetEmail({ to: recipient.data, resetUrl: link.data, idempotencyKey: `password-reset:${randomUUID()}` }));
}

export const accountEmails = { sendVerification, sendReset };
