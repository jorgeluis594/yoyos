# Logging conventions

Application logs should explain what happened, which operation was affected, and
where to investigate without exposing customer data. These conventions apply to
new and modified logging in Yoyos. See [Logging and observability](logging.md) for
the core server's infrastructure and New Relic deployment checks.

The core server already has a shared logger. Some worker and mobile paths still
use `console.*`; this document defines the intended conventions, not a claim that
every existing call follows them.

## Use the existing logger

In core server code, import from
[`src/shared/infrastructure/logger.ts`](../apps/core/src/shared/infrastructure/logger.ts):

- `log.info(...)`, `log.warn(...)`, and `log.error(...)` for application events.
  Request and company context is added automatically when a call runs inside an
  HTTP request; outside a request, `log` emits only process-level fields.

Use structured fields followed by a short, stable English message. Do not create
another logger wrapper, stringify objects yourself, or use `console.*` for new
core application logs.

```ts
import { log } from "@core/src/shared/infrastructure/logger";

// At the boundary that handles an unexpected persistence failure:
log.error({
  event: "order_create_failed",
  orderId,
  itemsCount,
  errorCode: "PERSISTENCE_UNAVAILABLE",
  err: cause,
}, "Order creation failed");
```

## Event names and fields

Use a stable `snake_case` event name describing an operation and outcome, such as
`order_create_failed` or `server_started`. Keep IDs, status codes, and other
variable values in fields, never in event names or message interpolation. Reuse
existing event names for the same operation; renaming them can break searches.

Prefer flat fields with consistent names and types:

| Field | Convention |
| --- | --- |
| `event` | Required stable diagnostic event name. |
| `service`, `level`, `time` | Supplied by the shared logger; do not override them. |
| `requestId` | Supplied by HTTP middleware; do not replace it at call sites. |
| `companyId` | Trusted tenant identity from authentication or validated worker context. |
| `userId`, `orderId`, `productId` | Internal identifiers, only when needed to investigate. |
| `errorCode` | Stable technical or application code, not an exception message. |
| `err` | Original thrown value, serialized by the shared error sanitizer. |
| `durationMs` | Numeric elapsed time in milliseconds. |
| `statusCode` | Numeric HTTP response status. |
| `itemsCount` | Count instead of a collection or its contents. |
| `eventId`, `jobId`, `handler`, `attempt`, `result` | Worker correlation and outcome; `attempt` starts at 1. |
| `eventName` | Business event name for worker logs; keep it distinct from the diagnostic `event`. |

Omit unavailable optional fields. Never spread a request, payload, domain object,
or third-party error into a log record. IDs are useful for investigation but
should not become metric labels with an unbounded number of values.

## Choose the level by operational impact

| Level | Use for |
| --- | --- |
| `debug` | Temporary, bounded diagnostic detail useful during an investigation. Privacy rules still apply. |
| `info` | Process lifecycle and useful completion summaries, including the existing HTTP completion event. |
| `warn` | Degraded behavior, an unusual rejection, or a failed attempt that will be retried. |
| `error` | An unexpected operation failure, invalid stored data, or exhausted retries requiring investigation. |
| `fatal` | An unrecoverable failure after which the process terminates. |

An expected validation error, missing record, duplicate submission, or business
rejection such as insufficient stock is normally a `Result` failure, not an
additional error log. The HTTP completion record already captures its status.
Do not log every function entry, database query, loop item, or successful read.
Logging at `fatal` does not itself terminate the process.

## Give each failure one owner

Log a technical failure once at the boundary that handles it and has the useful
context. An infrastructure adapter that catches a database exception and returns
`PERSISTENCE_UNAVAILABLE` owns that diagnostic record. Its caller translates the
result into an HTTP response without logging the same failure again.

If an exception propagates without being handled, the final request or worker
boundary owns the log. Keep domain rules pure and do not import the infrastructure
logger into domain code. Application use cases propagate results; logging belongs
at adapters and delivery boundaries.

An HTTP completion event and a diagnostic error are different records: the former
describes the request outcome; the latter explains the failure. Avoid adding a
second completion record in each route.

Keep public error responses generic. Never return internal stacks, database
details, or provider messages to the client. For detached asynchronous work,
handle both rejected promises and unsuccessful `Result` values; an HTTP success
does not mean that a later email or background operation succeeded.

## Preserve correlation and tenant boundaries

HTTP middleware accepts `x-request-id` only when it matches
`[a-zA-Z0-9_-]{8,64}`; otherwise it generates a UUID. It returns the chosen ID in
the response. Use `log` to retain this context across asynchronous
request work. A request ID is a correlation aid, never proof of identity.

Authentication binds `companyId` to the request context. Do not bind it from an
untrusted request body or mutate the process logger with tenant-specific fields.
Log normalized routes such as `/orders/:id`, not raw URLs or query strings.
The existing middleware emits `http_request_completed` at `info`, including for
unsuccessful HTTP responses; use `statusCode` to distinguish those outcomes.

Workers have no automatic HTTP context. Use selected
fields for each job, including a validated `companyId`, `eventId`, handler, and
attempt. Record a bounded outcome per attempt and distinguish retries from final
failure. Do not invent a request ID for unrelated background work. Trace fields
added by the monitoring agent should not be manufactured by application code.

The current event-bus adapter still uses the business event name in `event` and
has console logging. The separate `eventName` convention above is the target when
that adapter is updated; it is not implemented by this documentation change.

## Allowlist data before logging

Never log passwords, tokens, authorization headers, cookies, connection strings,
complete request or response bodies, customer names, email addresses, phone
numbers, WhatsApp content, payment details, or signed URLs. Prefer trusted internal
IDs, counts, stable codes, and measured durations.

The shared logger redacts known sensitive keys at configured nesting depths.
This is a fallback, not a guarantee: unexpected keys, different casing, deeper
objects, and secrets embedded in strings may escape key-based redaction.

Pass exceptions under `err`. The current `safeError` serializer replaces the
original message with `Unexpected failure` and preserves selected stack locations.
Do not bypass it with `cause.message`, `cause.stack`, `String(cause)`, raw database
`meta`, or a message interpolated from an exception. Error names must also be
trusted; the serializer preserves them. Add a reviewed `errorCode` and safe
operation context to make the sanitized record useful.

Use an application-owned constant for `errorCode`; do not copy arbitrary codes
from external failures into logs.

Logs support diagnosis; they are not the source of truth for sales, payments, or
an audit trail. Tenant fields do not replace database isolation or access controls
on the log platform.

## Runtime and verification

Core writes JSON to stdout with `info` as the default threshold and `LOG_LEVEL`
as the operational override. Keep one forwarding path into New Relic to avoid
duplicate ingestion; follow the infrastructure guide for configuration. Do not
add a database log table or a transport for each feature.

The Node.js logger and monitoring agent are server-only. Do not import them into
browser or Expo code. Client diagnostics follow the same data restrictions, and
temporary development diagnostics should be gated by the runtime's development
flag. Production client collection needs its own integration.

When adding or changing a meaningful log path, verify the failure or outcome that
triggers it, the event name and level, the safe context, and the absence of
duplicate diagnostics. For changes to serialization or redaction, inspect emitted
JSON with recognizable fake secrets and assert that none appear. The existing
[`logger.test.ts`](../apps/core/src/shared/infrastructure/logger.test.ts) covers
stdout redaction, error sanitization, request correlation, and tenant separation.
Do not test incidental timestamps or exact stack text.

## Reference and adaptations

This guide draws on the structured event approach in
[`animo-sales/src/lib/log.ts`](https://github.com/PECO-Devs/animo-sales/blob/HEAD/src/lib/log.ts)
and its
[purchase-order failure logging design](https://github.com/PECO-Devs/animo-sales/blob/HEAD/docs/superpowers/specs/2026-09-19-purchase-order-create-error-log-design.md),
reviewed on September 30, 2026. That design records a stable event, selected
diagnostic context, and a generic user-facing response.

Yoyos reuses its existing logger and adds explicit ownership, request and worker
correlation, severity guidance, and stricter data selection. In particular, do
not copy the reference design's raw error `message` or `meta` fields: use Yoyos's
sanitized `err` and reviewed error codes. The reference repository also has a
[recursive redaction helper](https://github.com/PECO-Devs/animo-sales/blob/HEAD/src/lib/log-redaction.ts),
but its logger wrapper does not call that helper automatically; do not assume
that having a redaction utility makes every log safe.
