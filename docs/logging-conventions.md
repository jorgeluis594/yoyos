# Logging conventions

Logs should explain what happened and provide enough safe context to investigate.
For infrastructure and deployment, see [Logging and observability](logging.md).

## Write a structured log

Use the shared logger in core server code, with an object followed by a short,
stable English message:

```ts
import { log } from "@core/src/shared/infrastructure/logger";

log.error({
  event: "unable_to_save_order",
  orderId,
  itemsCount,
  errorCode: "PERSISTENCE_UNAVAILABLE",
  err: cause,
}, "Unable to save order");
```

Use `log` directly instead of `console.*` or another wrapper. This logger is
server-only; do not import it into browser or mobile code.

## Choose the event

- Use a stable English `snake_case` name identifying the operation and outcome:
  `product_create_persistence_failed`, `email_verification_resend_failed`.
- Search existing logs first and reuse the event for the same operation.
  Preserve existing names, such as `unable_to_save_order`, so searches keep working.
- Keep variable values in fields: `orderId` belongs in the object, never in the
  event name or message. Avoid vague events such as `error` or `operation_failed`.

## Choose the data

Each log contains an `event`, a short message, and context chosen for that
operation. Choose context by asking: what was affected, what explains the outcome,
and what would help investigate it?

- Include only data that answers those questions. The example above illustrates
  one operation; its context fields are not a required schema for other logs.
- Keep fields flat, with descriptive names and consistent types. Store variable
  values as structured fields so they can be searched and filtered.
- Prefer identifiers and summaries over full objects or collections. Select
  fields explicitly; never spread entire objects or stringify them into messages.
- Omit unavailable or irrelevant data rather than adding placeholder fields.

Never log credentials, tokens, headers, cookies, connection strings, customer
names, emails, phone numbers, message content, payment details, signed URLs, or
complete request/response bodies. Automatic redaction is only a fallback.

Pass failures through `err`: the logger sanitizes the error message and stack.
Do not copy `cause.message`, `cause.stack`, `String(cause)`, or provider/database
metadata into other fields. Use a safe `errorCode` and selected context to explain
the failure; do not copy arbitrary external error codes or error names.

## Decide what to log and where

| Level | Use for |
| --- | --- |
| `debug` | Bounded diagnostic detail needed during an investigation. |
| `info` | Useful completion summaries and process lifecycle events. |
| `warn` | Degraded behavior or a failed attempt that will be retried. |
| `error` | Unexpected operation failures, invalid stored data, or exhausted retries. |
| `fatal` | Unrecoverable failures after which the process will terminate. |

Expected validation failures, missing records, duplicates, and business rejections
normally return a `Result` failure without an extra log. Avoid logging every
function call, query, loop item, or successful read.

Log a technical failure once where it is handled and useful context is available:
usually an infrastructure adapter or the final request/worker boundary. If an
adapter logs and returns a failed `Result`, its caller should not log it again.
Keep logging out of pure domain code and avoid duplicating HTTP completion logs.
For background work, handle both rejected promises and failed `Result` values.

When changing a log path, verify its event, level, useful context, absence of
sensitive data, and that the same failure is not logged twice.
