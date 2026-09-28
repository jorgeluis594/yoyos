# Adding emails

Email delivery runs on the `apps/core` server. Keep each email's content and sending logic in the feature that owns it; use `src/shared/emails` for the common layout and transport.

## Add a template

1. Create a React component with typed props in the feature's `infrastructure/emails` directory. Pass in the data it needs; do not read environment variables or fetch data inside the template.
2. Wrap its content in `EmailLayout` from `src/shared/emails/components/email-layout.tsx` to use the common email layout.
3. Render the component with `render` from `@react-email/render`, then use `toPlainText` on the HTML. Send both formats.

## Send the email

1. Define a feature-specific sending function or application port when a use case needs one. Its inputs should describe the email's purpose and required data, not HTML or transport settings.
2. In the feature's infrastructure, prepare the subject and render the template. Pass `{ to, subject, html, text, idempotencyKey }` to a `SendEmail` function from `src/shared/emails/application/send-email.ts`.
3. In the feature's `composition.ts`, inject the configured `sendEmail` exported by `src/shared/emails/composition.ts`. The shared composition chooses SMTP or Resend from server environment variables.
4. Handle the returned `Result`. A successful result means the transport accepted the message; it does not confirm delivery. Rendering and sending failures use `EMAIL_RENDER_FAILED` and `EMAIL_SEND_FAILED`.

For local testing, Compose sends SMTP email to Mailpit at `http://localhost:8025`. New templates use the same transport without changing its adapters.
