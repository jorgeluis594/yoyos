import type { Result } from "@shared/result";

export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}>;
export type EmailError = Readonly<{
  code: "EMAIL_RENDER_FAILED" | "EMAIL_SEND_FAILED";
  message: string;
}>;
export type SendEmail = (message: EmailMessage) => Promise<Result<Readonly<{ emailId: string }>, EmailError>>;
