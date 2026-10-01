# Event bus quick start

Use the core backend event bus for work that can run after a business operation,
such as sending a receipt. Production persists one PostgreSQL job per registered
handler; a separate worker executes them. Keep required business invariants
(such as stock updates) inside the business transaction.

There are currently no business events or handlers registered. The following
`order.completed` example shows how to add one; it is not an existing feature.
Paths below are relative to `apps/core/src/`.

## 1. Declare the event

Create `features/orders/application/events.ts`:

```ts
import type { EventHandler } from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";

declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents {
    "order.completed": { orderId: string };
  }
}

export type OrderCompletedHandler = EventHandler<AppEvents, "order.completed">;
```

`companyId` is required automatically by `EventPayload`. Use JSON data: IDs and
the minimum snapshot the handler needs. Name events after facts that occurred.

## 2. Validate the payload

Create `features/orders/infrastructure/event-payloads.ts`:

```ts
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type {
  EventBusError, EventPayload,
} from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import type {} from "@core/src/features/orders/application/events";
import type { Result } from "@shared/result";

const orderCompletedSchema = z.strictObject({
  companyId: z.uuid(),
  orderId: z.uuid(),
});

export function parseOrderCompleted(
  input: unknown,
): Result<EventPayload<AppEvents, "order.completed">, EventBusError> {
  const parsed = orderCompletedSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "INVALID_EVENT", message: "Invalid order.completed payload" });
}
```

The production adapter calls this parser before persisting and before executing
the handler. Keep JSON validation in feature infrastructure.

## 3. Define and register a handler

Implement the application handler as an `OrderCompletedHandler`, with its
dependencies injected. Its arguments are `(payload, metadata, context)`:

- `payload` includes `companyId` and `orderId`.
- `metadata` includes `eventId` and `occurredAt`, preserved across job retries.
- `context` includes `attempt` (starting at 1) and the native `AbortSignal`.

Return `ok(undefined)` on success. Return
`err({ code: "...", message: "...", retryable: true })` for a temporary failure,
or `retryable: false` for a permanent failure. Unexpected exceptions also retry.

Export the handler and parser through `features/orders/index.ts`. In
`composition/event-handlers.ts`, import those public exports and add a definition
to the existing `eventHandlers` array:

```ts
const sendOrderReceipt = defineEventHandler<AppEvents, "order.completed">(
  "order.completed",
  sendOrderReceiptHandler,
  {
    id: "send-order-receipt",
    parsePayload: parseOrderCompleted,
    policy: { retries: 4, concurrency: 1 },
  },
);

export const eventHandlers: AnyEventSubscription<AppEvents>[] = [sendOrderReceipt];
```

The example assumes `sendOrderReceiptHandler` has already been composed with its
dependencies. Handler IDs are stable queue names, unique across the registry,
and must match `^[a-z][a-z0-9-]*$`. Both producers and workers load this array;
registering only in a worker is insufficient.

Omit `policy` to use 4 additional retries, a 5 second retry delay, exponential
backoff, and concurrency 1 per handler per worker process. Override only the
fields needed. The worker entrypoint already bootstraps the registered handlers.

## 4. Publish from an application use case

At the existing composition boundary, obtain `publishEvent` from
`createEventBusRuntime()` and inject it into the use case. Reuse that process's
runtime and start its provider before accepting work. Application code should
receive the publication function as a dependency.

```ts
// Inside the use case, after the business transaction commits:
const published = await publishEvent("order.completed", { companyId, orderId });
if (!published.success) {
  return published; // Or explicitly map this failure to the use case's error.
}
```

Publish inside the existing authorized company context. `companyId` must be a
UUID matching that context; production rejects missing or mismatched context.
The worker restores tenant isolation before calling the handler.

`publishEvent` generates a UUID and UTC timestamp. Always await its `Result`:
success means all matching jobs were persisted, not that handlers finished.
An event with no registered handlers succeeds without creating any jobs.

The job inserts are atomic with each other, but separate from the business
transaction. A publication failure does not undo a committed order. Decide how
the use case reports or recovers this failure; the bus has no outbox. To retry a
publication with the same metadata, use the injected `EventPublisher.publish`
port directly. Reusing metadata does not deduplicate jobs automatically.

## 5. Run and test

Docker Compose starts the worker alongside core and PostgreSQL. To run the
worker separately with configured environment variables:

```sh
pnpm --dir apps/core worker
```

`EVENT_BUS_DATABASE_URL` overrides `DATABASE_URL` for jobs. Apply the existing
migrations and role provisioning first; normal startup does not create the
technical schema.

For application tests, use `createInMemoryEventBus<AppEvents>()`, register the
definition with `subscribeToEvent(bus, definition)`, check the registration
`Result`, and inject `createPublishEvent<AppEvents>(bus)`. Unlike production,
in-memory publishing waits for handlers, returns their failures, and does not
simulate durable jobs, retry policies, or tenant isolation. IDs and time can be
injected as the second and third arguments to `createPublishEvent`.

Before shipping, cover successful publication, publication failure, and the
handler's meaningful failure boundary. Verify required handlers are in the
composition registry. Make effects idempotent: jobs can execute again after a
crash or retry, and there is no global execution order. Local unsubscribe stops
the consumer without deleting its queue or pending jobs.
