import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { SendEmail } from "@core/src/shared/emails/application/send-email";
import { createAccountEmails } from "@core/src/features/users/infrastructure/emails/account-emails";
import { emailAddressSchema, accountVerificationUrlSchema, passwordResetUrlSchema } from "@core/src/features/users/application/account-links";

const to = emailAddressSchema.parse("Ana+ventas@example.com");
const verificationUrl = accountVerificationUrlSchema.parse("http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2Faccount-verified");
const resetUrl = passwordResetUrlSchema.parse("http://localhost:3000/api/auth/reset-password/abc?callbackURL=%2Freset-password");

test("account messages select the right subject and escape template content", async () => {
  const sent: Parameters<SendEmail>[0][] = [];
  const emails = createAccountEmails(async (message) => { sent.push(message); return ok({ emailId: "mail-1" }); });
  expect(await emails.sendVerificationEmail({ to, verificationUrl, idempotencyKey: "verification:stable" })).toEqual(ok(undefined));
  expect(await emails.sendPasswordResetEmail({ to, resetUrl, idempotencyKey: "reset:stable" })).toEqual(ok(undefined));
  expect(sent.map(({ to: recipient, subject, text, idempotencyKey }) => ({ recipient, subject, text, idempotencyKey }))).toMatchObject([
    { recipient: "ana+ventas@example.com", subject: "Verifica tu correo de Yoyos", idempotencyKey: "verification:stable" },
    { recipient: "ana+ventas@example.com", subject: "Recupera tu contraseña de Yoyos", idempotencyKey: "reset:stable" },
  ]);
  expect(sent[0].html).toContain("/api/auth/verify-email?token=abc&amp;callbackURL=");
  expect(sent[0].html).toContain("Verificar correo");
  expect(sent[0].text).toContain("http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=");
  expect(sent[1].html).toContain("Cambiar contraseña");
  expect(sent[1].text).toContain("30 minutos");
});

test("account email reports the transport failure", async () => {
  const emails = createAccountEmails(async () => err({ code: "EMAIL_SEND_FAILED", message: "Unable to send email" }));
  expect(await emails.sendVerificationEmail({ to, verificationUrl, idempotencyKey: "verification:retry" }))
    .toEqual(err({ code: "EMAIL_SEND_FAILED", message: "Unable to send email" }));
});

test("email and action-specific URLs reject malformed or cross-purpose values", () => {
  expect(emailAddressSchema.safeParse("bad address").success).toBe(false);
  expect(emailAddressSchema.parse("Ana+ventas@example.com")).toBe("ana+ventas@example.com");
  expect(accountVerificationUrlSchema.safeParse("https://evil.example/api/auth/verify-email?token=x").success).toBe(false);
  expect(accountVerificationUrlSchema.safeParse("http://localhost:3000/api/auth/reset-password/x").success).toBe(false);
  expect(accountVerificationUrlSchema.safeParse("http://localhost:3000/api/auth/verify-email.evil?token=x").success).toBe(false);
  expect(passwordResetUrlSchema.safeParse("http://localhost:3000/api/auth/reset-password/x").success).toBe(true);
  expect(passwordResetUrlSchema.safeParse("http://localhost:3000/api/auth/reset-password/x/y").success).toBe(false);
});
