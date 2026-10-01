import { render, toPlainText } from "@react-email/render";
import { err, ok } from "@shared/functional";
import type { EmailError, SendEmail } from "@core/src/shared/emails/application/send-email";
import type { SendAccountVerificationLink, SendPasswordResetLink } from "@core/src/features/users/application/account-links";
import { PasswordResetEmail } from "@core/src/features/users/infrastructure/emails/password-reset-email";
import { VerificationEmail } from "@core/src/features/users/infrastructure/emails/verification-email";

function createMessage(to: string, url: string, subject: string, idempotencyKey: string, template: "verification" | "reset") {
  return render(template === "verification" ? <VerificationEmail url={url} /> : <PasswordResetEmail url={url} />)
    .then((html) => ({ to, subject, html, text: toPlainText(html), idempotencyKey }));
}

export function createAccountEmails(sendEmail: SendEmail): Readonly<{
  sendVerificationEmail: SendAccountVerificationLink;
  sendPasswordResetEmail: SendPasswordResetLink;
}> {
  return {
    async sendVerificationEmail(input) {
      let message;
      try { message = await createMessage(input.to, input.verificationUrl, "Verifica tu correo de Yoyos", input.idempotencyKey, "verification"); }
      catch { return err({ code: "EMAIL_RENDER_FAILED", message: "Unable to render verification email" }); }
      const sent = await sendEmail(message);
      return sent.success ? ok(undefined) : sent;
    },
    async sendPasswordResetEmail(input) {
      let message;
      try { message = await createMessage(input.to, input.resetUrl, "Recupera tu contraseña de Yoyos", input.idempotencyKey, "reset"); }
      catch { return err<EmailError>({ code: "EMAIL_RENDER_FAILED", message: "Unable to render password reset email" }); }
      const sent = await sendEmail(message);
      return sent.success ? ok(undefined) : sent;
    },
  };
}
