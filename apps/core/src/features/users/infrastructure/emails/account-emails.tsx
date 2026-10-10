import { render } from "@react-email/render";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import resources from "@core/app/locales";
import { err, ok } from "@shared/functional";
import type { EmailError, SendEmail } from "@core/src/shared/emails/application/send-email";
import type { SendAccountVerificationLink, SendPasswordResetLink } from "@core/src/features/users/application/account-links";
import { emailPlainText } from "@core/src/shared/emails/components/email-layout";
import { PasswordResetEmail } from "@core/src/features/users/infrastructure/emails/password-reset-email";
import { VerificationEmail } from "@core/src/features/users/infrastructure/emails/verification-email";

function languageForLink(url: string): "es" | "pt" {
  try {
    const callback = new URL(url).searchParams.get("callbackURL");
    return callback && new URL(callback, url).pathname.split("/")[1] === "pt-BR" ? "pt" : "es";
  } catch { return "es"; }
}

async function createMessage(to: string, url: string, idempotencyKey: string, template: "verification" | "reset") {
  const i18n = createInstance();
  await i18n.init({ lng: languageForLink(url), resources });
  const subject = i18n.t(template === "verification" ? "emails.verificationSubject" : "emails.resetSubject");
  const html = await render(<I18nextProvider i18n={i18n}>{template === "verification" ? <VerificationEmail to={to} url={url} /> : <PasswordResetEmail url={url} />}</I18nextProvider>);
  return { to, subject, html, text: emailPlainText(html), idempotencyKey };
}

export function createAccountEmails(sendEmail: SendEmail): Readonly<{
  sendVerificationEmail: SendAccountVerificationLink;
  sendPasswordResetEmail: SendPasswordResetLink;
}> {
  return {
    async sendVerificationEmail(input) {
      let message;
      try { message = await createMessage(input.to, input.verificationUrl, input.idempotencyKey, "verification"); }
      catch { return err({ code: "EMAIL_RENDER_FAILED", message: "Unable to render verification email" }); }
      const sent = await sendEmail(message);
      return sent.success ? ok(undefined) : sent;
    },
    async sendPasswordResetEmail(input) {
      let message;
      try { message = await createMessage(input.to, input.resetUrl, input.idempotencyKey, "reset"); }
      catch { return err<EmailError>({ code: "EMAIL_RENDER_FAILED", message: "Unable to render password reset email" }); }
      const sent = await sendEmail(message);
      return sent.success ? ok(undefined) : sent;
    },
  };
}
