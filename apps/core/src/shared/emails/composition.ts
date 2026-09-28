import { z } from "zod";
import type { SendEmail } from "@core/src/shared/emails/application/send-email";
import { createResendEmailSender, createSmtpEmailSender } from "@core/src/shared/emails/infrastructure/senders";

const senderSchema = z.string().trim().min(1).refine((value) => /^[^<>]*<[^<>\s@]+@[^<>\s@]+>$/.test(value));

function configuredSendEmail(): SendEmail {
  const transport = process.env.EMAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "resend" : "smtp");
  const from = senderSchema.safeParse(process.env.EMAIL_FROM ?? (transport === "smtp" ? "Yoyos <cuentas@yoyos.test>" : ""));
  if (!from.success) throw new Error("EMAIL_FROM must be a valid sender name and address");
  if (transport === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is required when EMAIL_TRANSPORT=resend");
    return createResendEmailSender(apiKey, from.data);
  }
  if (transport === "smtp") {
    const host = process.env.SMTP_HOST ?? (process.env.NODE_ENV === "production" ? "" : "localhost");
    const port = Number(process.env.SMTP_PORT ?? 1025);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_HOST and a valid SMTP_PORT are required when EMAIL_TRANSPORT=smtp");
    return createSmtpEmailSender(host, port, from.data);
  }
  throw new Error("EMAIL_TRANSPORT must be resend or smtp");
}

export const sendEmail = configuredSendEmail();
