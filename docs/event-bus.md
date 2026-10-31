# Event bus and background jobs

The core backend publishes typed domain events and runs their handlers as
durable jobs in a separate worker process. Use it for work that can happen after
a business operation commits (restoring stock after a cancellation, indexing a
product image, applying a chat message to an order, sending a seller notice). Invariants that must
hold for an operation to succeed stay inside its business transaction; a later
job never replaces them.

## Decisions

| Decision | Reason |
| --- | --- |
| Production provider is `pg-boss` on PostgreSQL, schema `pgboss` | Durable jobs on the database Yoyos already operates, MIT licensed, no extra service. |
| Handlers run in a worker process, not in Express | A slow or failing handler never blocks or crashes request handling. |
| An in-memory provider exists only for application tests | Fast tests without a database; production has no fallback to it. |
| One queue per handler, shared by all companies | Each handler gets its own retry policy and backlog; a retry never re-runs handlers that already succeeded. |
| `publishEvent` awaits job persistence and returns a `Result` | Persistence failures are visible to the use case instead of being lost by fire-and-forget. |
| No outbox | Publication is separate from the business transaction; each use case decides how to report a publication failure. Rejected: building an outbox into the bus API. |
| At-least-once delivery, no global ordering; ordering per key is opt-in (`orderingKey`) | A crash after an effect and before job completion re-runs the job, so every handler effect must be idempotent. Only handlers whose effects depend on the previous job of the same key pay for ordering. |
| The bus lives in `apps/core`, not in root `shared/` | It is backend infrastructure; mobile does not use it. |

## Concepts

- An **event** is a fact that occurred, for example `order_cancelled`.
- A **job** is one execution of one registered handler for that event. Publishing
  creates one job per handler registered for the event; an event with no
  handlers succeeds without creating jobs.
- Worker replicas compete for jobs of the same queue; they are not extra subscribers.
- Every event payload carries `companyId`. Payloads hold JSON data only: IDs and
  the minimum snapshot the handler needs. A handler that reads current data must
  accept it may have changed since the event occurred.

Contracts (`EventPublisher`, `EventSubscriber`, `EventHandler`, `HandlerPolicy`,
`EventMetadata`, error types) are defined in
`apps/core/src/shared/events/application/contracts.ts`; the event registry is
`apps/core/src/shared/events/application/app-events.ts`. Provider types never
reach application code.

## Delivery and failures

- Publishing succeeds once all jobs of the fan-out are persisted in one short
  provider transaction; it does not mean handlers finished. A publication that
  never reached the queue is not retried by pg-boss.
- `eventId` and `occurredAt` are generated when the fact is produced and are kept
  across retries.
- Handler results:
  - `ok(undefined)` completes the job.
  - `err({ retryable: true })` fails the attempt and applies the retry policy.
  - `err({ retryable: false })` fails permanently without using remaining retries.
  - An unexpected exception is logged and fails the attempt; it may be retried.
- Stored envelopes and payloads are validated with Zod when persisting and when
  consuming. Invalid stored data fails permanently and never reaches the handler.
- Default policy, overridable per handler: 4 retries (5 attempts), 5 second
  delay, exponential backoff, concurrency 1 per handler per worker process.
  Policies are validated at startup; invalid values are rejected, not corrected.
  Concurrency is per process, not a global rate limit.
- Expiration uses pg-boss's native job expiration. Handlers receive the job's
  native `AbortSignal`; expiration does not undo external effects.
- Completed and failed jobs are kept (`deleteAfterSeconds: 0`) for diagnosis and
  manual reprocessing. Schema growth must be watched.

## Ordering, groups, deadlines and dead letter

Opt-in `HandlerPolicy` fields, validated at startup (invalid values are
rejected, never corrected). The in-memory provider ignores ordering, groups,
expiry and retention, and calls the dead-letter handler after the last failed
attempt.

- `orderingKey(payload)`: the queue uses the pg-boss `key_strict_fifo` policy and
  each job is sent with that `singletonKey`. Jobs of one key run one at a time in
  publication order, and a retrying job holds back the next job of its key while
  other keys keep running. It requires `deadLetter`.
- `groupKey(payload)` and `groupConcurrency`: a job is sent with `group: { id }`
  and at most `groupConcurrency` jobs of one group run at once per worker process
  (see `localGroupConcurrency` below).
- `retryDelayMaxSeconds`, `expireInSeconds`, `heartbeatSeconds` (at least 10 and
  below `expireInSeconds`) and `deleteAfterSeconds` map to the pg-boss queue options.
- `deadLetter: { id, handler, policy }`: the provider creates the dead-letter queue
  and its worker. After the handler succeeds, the provider deletes the source job
  (`deleteJob`, from the source name and ID the dead-letter job carries), which
  releases its ordering key. If the deletion or the handler fails, the dead-letter
  job fails and is retried, so the key stays blocked until the chat can be released.
- The provider runs `superviseIntervalSeconds: 10` (supervise and monitor), so an
  expired or heartbeat-less attempt is failed within about ten seconds.

### pg-boss 12.35 checks (verified by integration tests)

- A key with a job in `active`, `retry` or `failed` is blocked. A job that ends
  `failed` is copied to the dead-letter queue and stays `failed` until deleted.
- The dead-letter job carries the source job's name and ID (`includeMetadata`).
- `groupConcurrency` (server side) works with `key_strict_fifo` but is checked by
  each poller before it claims, so the concurrent pollers of one worker exceed the
  limit. The provider therefore passes `localGroupConcurrency`: exact per worker
  process, not shared across worker replicas. Use one worker replica, or divide
  the limit, when a company-wide cap matters.
- A crashed attempt is failed by `heartbeatSeconds` into `retry`; pg-boss raises
  `retry_count` when the job is fetched again.

### Queues with these policies

| Queue | Event | Policy | Documented in |
| --- | --- | --- | --- |
| `apply-chat-message` | `message_created` | Ordering key = chat, group = company (8 per worker process, 16 slots), 8 retries from 5 s capped at 100 s, 85 s attempt deadline inside the handler, `expireInSeconds` 90, heartbeat 30 s, dead letter `apply-chat-message-dead-letter` (8 retries, 30 s fixed), 7-day retention | [message-to-order](message-to-order.md#order-of-processing-and-failures) |
| `send-chat-message-notice` | `chat_message_processed` | No ordering key, concurrency 4, 5 retries from 15 s capped at 150 s, `expireInSeconds` 15, 7-day retention | [notifications](notifications.md#sending) |

A handler that needs a deadline shorter than the job's expiry combines the job's
`AbortSignal` with its own and passes it to its provider calls; expiry stays the
safety net behind it.

### Blocked keys

`listBlockedKeys(handlerId)` returns the ordering keys held by a `failed` job
(a missing queue counts as none). The scheduled job `report-blocked-chat-keys`
runs every 5 minutes over the handlers with an `orderingKey` and logs
`orders_chat_queue_blocked` (error, `handler`, `blockedKeys` count) when any key
is blocked; with no ordered handler it logs nothing. Runbook:

```sql
SELECT id, singleton_key FROM pgboss.job WHERE name = '<handler-id>' AND state = 'failed';
```

Then `boss.retry('<handler-id>', id)` or delete the job after recording why.

### Database pool

Core builds Prisma on `@prisma/adapter-pg`, which ignores URL pool parameters.
`DATABASE_POOL_MAX` is passed as `max` to `PrismaPg` (unset keeps the driver
default of 10). The worker sets 24 in `compose.yaml`; the worker's connections
(Prisma, pg-boss 10, publishing pool 10) plus the web server's must stay below
PostgreSQL `max_connections`.

## In-transaction events

An explicit exception to "events after commit": a small synchronous publisher,
`apps/core/src/shared/events/application/in-transaction-events.ts`, runs an
event's handler **inside the producer's open transaction** and returns the
handler's outcome to the producer. It does not use pg-boss, has no retry and
persists nothing of its own; the producer's transaction is the unit of retry.

Use it only when the handler:

- writes to the **same database** as the producer, in the same transaction;
- is **idempotent** under the row locks it takes (the guarded writes make a
  repeated event harmless);
- performs **no external I/O** (no network, no queue, no file).

Everything else stays on pg-boss after commit. The first and only users are the
stock events of orders: `payment_confirmed`, `order_delivery_changed`,
`order_edited`, `order_stock_deduction_overdue` and `product_stock_increased`, so a payment
answers with the stock already deducted and a restock deducts the orders it
covers in the same step ([Orders · Stock deduction](orders.md#stock-deduction)).

How it works:

- Events are declared by merging into `InTransactionEvents` (`{ [name]: { payload, outcome } }`).
  There is exactly one handler per event, and the registry type makes a missing
  or extra handler a compile error. The registry is built in the feature that
  owns the handlers (`features/orders/composition.ts`) and handed to other
  features as a function, so a producer in another feature never imports orders.
- The publisher requires an active transaction of the payload's company, then
  runs the handler inside a **savepoint** (`withinSavepoint` in
  `shared/infrastructure/persistance.ts`) with statement and lock timeouts of
  `min(1000, 4000 - elapsed)` ms, so a contended handler ends as a contained
  timeout before Prisma's 5000 ms timer.
- Failures are split by `classifyPersistenceFailure`. **Transaction-ending**
  errors (Prisma's transaction timeout P2028, a lost connection) are returned and
  the producer rolls back, so its retry is safe. **Everything else** (lock or
  statement timeout, deadlock, any other database error, invalid stored data, an
  unexpected row count) rolls back to the savepoint, is logged, and becomes a
  `failed` outcome: the producer still commits.
- On rollback to the savepoint the scope is restored: abort state back to what it
  was and the after-commit observers registered inside discarded, so a
  rolled-back deduction never logs a success. Timeouts the handler set are
  restored to the producer's values whether the savepoint is released or rolled back.
- Whatever a contained failure leaves undone is finished by a recovery job
  (`recover-due-stock-deductions`, once a minute, three passes), not by an outbox.

Producers that publish run their transaction with `lockTimeoutMs` 2000 and
`statementTimeoutMs` 3000 under the 5000 ms Prisma timeout.

## Tenant isolation

`companyId` comes from the authorized company context and must match the
payload; the provider rejects missing or mismatched context. The worker runs
each handler inside `withTenantIsolation(companyId, ...)`, so concurrent jobs
never share a company context. The `pgboss` schema is cross-company operational
infrastructure reachable only from backend processes; it does not justify
`BYPASSRLS` or ownership of business tables. See [RLS with Prisma](rls-with-prisma.md).

## Registry and lifecycle

- The handler registry is static: `eventHandlers` in
  `apps/core/src/composition/event-handlers.ts`, built from public feature
  exports. Producers and the worker load the same registry, so registering a
  handler only in the worker is not enough.
- Handler IDs are stable queue names, unique in the registry, matching
  `^[a-z][a-z0-9-]*$`.
- Express only publishes; the worker (`apps/core/src/worker.ts`) consumes and may
  publish follow-up events. Both verify the `pgboss` schema at startup and never
  migrate it; a connection, schema or registry error keeps the process from
  becoming ready.
- On `SIGTERM`/`SIGINT` the worker stops taking jobs, drains for a bounded time
  and closes connections; unfinished jobs are recovered by pg-boss.
- Unsubscribing stops the local consumer only; it does not delete the queue or
  pending jobs. Removing a handler or an incompatible payload change requires
  draining its pending jobs first. Compatible additions may keep the event name.
- Scheduled (cron) jobs are registered only by the worker in
  `apps/core/src/composition/scheduled-jobs.ts`. A job may carry a queue policy
  (`stately`, `retryLimit`, `expireInSeconds`); `recover-due-stock-deductions` runs
  `* * * * *` on a standard queue with no retry and 58 s expiry (a `stately` queue was
  measured to start a job up to 55 s late after a long run). pg-boss 12.35 sends at
  most one cron job per 60-second slot, so its sub-minute cadence comes from three
  passes inside one run, and the provider sets `cronMonitorIntervalSeconds: 10`.

## How to add an event and handler

Paths are relative to `apps/core/src/`.

1. Declare the event in `features/<feature>/application/events.ts` by extending
   `AppEvents` through declaration merging. Name it after the fact.
2. Add a Zod parser in `features/<feature>/infrastructure/event-payloads.ts`
   that returns `Result<EventPayload<...>, EventBusError>` with code `INVALID_EVENT`.
3. Implement the handler in the feature's application layer with explicit
   dependencies. It receives `(payload, metadata, context)`; `context.attempt`
   starts at 1.
4. Register it in `composition/event-handlers.ts` with `defineEventHandler(name,
   handler, { id, parsePayload, policy? })` and add it to `eventHandlers`.
5. In the use case, receive `publishEvent` by injection (obtained from
   `createEventBusRuntime()` in composition) and call it after the business
   transaction commits, always handling its `Result`:

   ```ts
   const published = await publishEvent("order_cancelled", { companyId, orderId });
   if (!published.success) return published;
   ```

   To retry a publication with the same metadata, call `EventPublisher.publish`
   directly; reusing metadata does not deduplicate jobs.

### Testing

Use `createInMemoryEventBus<AppEvents>()`, register with
`subscribeToEvent(bus, definition)` and inject `createPublishEvent<AppEvents>(bus)`
(IDs and clock are injectable). In-memory publishing waits for handlers and
returns their failures; it does not simulate durability, retries or tenant
isolation, which integration tests cover against PostgreSQL. Cover successful
publication, publication failure, the handler's failure boundary, and that
required handlers are in the registry.

## Operation

- Run the worker with `pnpm --dir apps/core worker`; Docker Compose starts a
  `worker` service from the core image after `migrate`.
- `EVENT_BUS_DATABASE_URL` points jobs to another PostgreSQL database; it
  defaults to `DATABASE_URL`.
- The Prisma migration and `apps/core/scripts/provision-role.sql` create the
  schema and grant the restricted role access. pg-boss automatic `reindex` is
  disabled; reindexing is an operational task with migration credentials.
- Worker readiness is the `Event worker ready` log. Execution logs include
  `eventId`, event, handler, company, attempt, duration and result, never the payload.
- Inspect backlog and failures:

  ```sql
  SELECT name, state, count(*) AS jobs, min(created_on) AS oldest_created_on
  FROM pgboss.job GROUP BY name, state ORDER BY name, state;
  ```

- Reprocess a failed job only after fixing its cause and confirming the handler
  is idempotent: `boss.retry('<handler-id>', jobId)`. Record the reason and job ID.
  For `apply-chat-message`, the event ID is the message ID, idempotency comes from
  the `ChatMessageOutcome` primary key, a late retry may apply the message to a
  different open order of the chat, and republishing `message_created` is not
  possible because the message is already marked as dispatched.
