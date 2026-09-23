# Programming Style

The repository uses small functions, plain data, and explicit composition.
Business rules are pure: they receive what they need, do not mutate their inputs,
and do not access databases, networks, or global state. Use cases receive their
dependencies as arguments and coordinate effects through adapters.

Fallible operations return `Result<T, E>` or `Promise<Result<T, E>>`. Success
contains `data`; failure contains `error`, with a required `message` and optional
`code`. Transformations that always produce a value return it directly. Valid
absence is represented as success with `null`, never by hiding a failed lookup.

To compose operations:

- `ok` and `err` construct results.
- `map` transforms successful data; `mapError` transforms the error.
- `andThen` chains a Result-returning operation and preserves error types.
- `mapAsync` and `andThenAsync` support asynchronous steps.
- `sequence` collects already evaluated results; `traverse` processes items and
  stops invoking its callback at the first failure.

Failures propagate without executing steps that depend on their value. Early
returns are also valid when they express the flow more clearly. These functions
neither catch exceptions nor undo effects: adapters and boundary handlers
translate technical errors and keep their details observable internally.

Types are defined in [result.ts](../shared/result.ts), and functions in
[functional.ts](../shared/functional.ts). Import them from `@shared/result` and
`@shared/functional`, respectively. Runnable examples are in
[functional.test.mjs](../shared/functional.test.mjs).
