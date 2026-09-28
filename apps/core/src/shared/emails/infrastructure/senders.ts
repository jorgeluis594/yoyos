import { Resend } from "resend";
import nodemailer from "nodemailer";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { SendEmail, EmailError, EmailMessage } from "@core/src/shared/emails/application/send-email";

const responseSchema = z.object({ data: z.object({ id: z.string().min(1) }).nullable(), error: z.unknown().nullable() });

export function createResendEmailSender(apiKey: string, from: string): SendEmail {
  const resend = new Resend(apiKey);
  return async (message: EmailMessage) => {
    try {
      const response = responseSchema.safeParse(await resend.emails.send({
        from, to: message.to, subject: message.subject, html: message.html, text: message.text,
      }, { idempotencyKey: message.idempotencyKey }));
      return response.success && response.data.data && !response.data.error
        ? ok({ emailId: response.data.data.id })
        : err<EmailError>({ code: "EMAIL_SEND_FAILED", message: "Resend returned an invalid response" });
    } catch {
      return err({ code: "EMAIL_SEND_FAILED", message: "Unable to send email" });
    }
  };
}

export function createSmtpEmailSender(host: string, port: number, from: string): SendEmail {
  const transporter = nodemailer.createTransport({ host, port, secure: false });
  return async (message: EmailMessage) => {
    try {
      const sent = await transporter.sendMail({
        from, to: message.to, subject: message.subject, html: message.html, text: message.text,
        headers: { "X-Idempotency-Key": message.idempotencyKey },
      });
      return sent.messageId ? ok({ emailId: sent.messageId }) : err({ code: "EMAIL_SEND_FAILED", message: "SMTP did not return a message ID" });
    } catch {
      return err({ code: "EMAIL_SEND_FAILED", message: "Unable to send email" });
    }
  };
}
