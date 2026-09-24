# Programming Style

The repository uses small functions, plain data, and explicit composition.
Business rules are pure: they receive what they need, do not mutate their inputs,
and do not access databases, networks, or global state. Use cases receive their
dependencies as arguments and coordinate effects through adapters.

Use type driven design: define domain types and explicit input and output types
for business operations before implementing their logic. Dependency contracts
also declare what each operation accepts and returns. Represent business variants
with discriminated unions, keeping each variant's required fields explicit.
Separate creation inputs from persisted entities when their requirements differ;
for example, a persisted entity must have an ID. Validate external data before
passing it to business logic, and avoid `as` assertions that hide incomplete
contracts.

All JSON communication between backend, mobile, and frontend must use Zod
schemas at the communication boundary. Parse incoming data before invoking the
application use case, and parse remote responses before returning them from an
adapter. Validate outgoing application-owned JSON against its response schema.
Infer transport types from schemas with `z.infer`; do not maintain parallel
handwritten DTO types or cast unvalidated JSON. Shared HTTP schemas belong in
root `shared/` and must not import app entities or persistence models.

Use `safeParse` and translate validation failures into the repository's `Result`
errors at the boundary. Domain rules and application operations receive validated
plain data and enforce their own business invariants; they do not receive
`ZodError` or HTTP objects. SDK TypeScript annotations do not replace runtime
validation of the data consumed by application-owned adapters.

Fallible operations return `Result<T, E>` or `Promise<Result<T, E>>`. Success
contains `data`; failure contains `error`, with a required `message` and optional
`code`. Transformations that always produce a value return it directly. Valid
absence is represented as success with `null`, never by hiding a failed lookup.

To compose operations:

- `ok` and `err` construct results.
- `map` transforms successful data; `mapError` transforms the error.
- `andThen` chains a Result-returning operation and preserves error types.
- `pipe` and `pipeAsync` chain Result-returning steps, stopping at the first failure.
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
