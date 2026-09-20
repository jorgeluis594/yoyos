# Persistence Conventions

## Purpose

Persistence adapters translate between application data and a data source. They may read, write, map, scope, transact, and translate expected technical failures. They must not decide business behavior.

These conventions apply to database repositories in the API and to remote or local data adapters in the Expo mobile app. Follow the boundaries in [Application Architecture](architecture.md) and verify behavior according to [Testing Conventions](testing-conventions.md).

## File Hierarchy

Keep each adapter inside the feature that owns its data:

```text
src/features/<feature>/
├── application/
│   ├── use-cases/
│   │   └── create-order.ts          # Business operation and coordination
│   └── ports/
│       └── order-repository.ts     # Application-owned dependency contract
└── infrastructure/
    ├── order-repository.ts         # Concrete data-access implementation
    ├── order-repository.test.ts    # Observable persistence behavior
    ├── order-mapper.ts             # Optional technical mapping helpers
    └── order-mapper.test.ts        # Mapping behavior, when needed
```

Use the same hierarchy within `apps/api/` and `apps/mobile/`. An API adapter may use a database; a mobile adapter may use an API or local storage. Separate adapter files or source-specific subdirectories only when multiple real implementations require them.

Keep small mapper helpers local to the repository. Extract them when size or reuse justifies it. A small dependency contract may remain inline with its use case instead of requiring a separate port file.

Shared connections and clients belong in `src/infrastructure/`. Feature queries, endpoint paths, and storage keys belong in the feature adapter. Application composition supplies configured dependencies; repositories must not create a new connection or client for every operation.

## Responsibility Boundary

Before adding repository behavior, determine whether it represents a storage concern or a business decision.

| Persistence responsibility | Responsibility outside persistence |
| --- | --- |
| Store the status explicitly supplied by the caller | Decide the next business status |
| Map a stored numeric value to the application's declared representation | Calculate a price, discount, or business total |
| Query using normalized filters and pagination | Interpret URL parameters or choose business defaults |
| Restrict reads and writes to the supplied ownership scope | Decide which business actions a role may perform |
| Enforce reference and uniqueness constraints | Decide whether a business operation is valid |
| Atomically execute the requested writes | Coordinate a workflow across features or send business notifications |

When an operation mixes these responsibilities, move policy and coordination to domain functions or use cases. The adapter must receive explicit persistence instructions and preserve their business meaning.

## Contracts and Input

Application operations define the capabilities they need. Repositories must implement those contracts without exposing database models, query builders, storage SDK objects, HTTP response objects, or driver-specific errors to callers.

- Receive explicit values and already-normalized filters, sorting, search terms, limits, offsets, or cursors.
- Do not trim business strings, derive business defaults, silently clamp pagination, or reinterpret supplied values.
- Keep transport parsing and input-shape validation at presentation boundaries; keep business normalization and invariants in domain or application code.
- Preserve technical safeguards: use parameterized queries and allowlisted mappings for dynamic query fields. Normalized input does not authorize unsafe query construction.
- Return the application shape and absence or failure semantics defined by the contract. Do not silently substitute an empty result for a failed read.

Separate write/entity repositories from specialized search adapters only when their responsibilities actually differ. Do not introduce a generic repository framework to standardize unrelated feature contracts.

## Technical Mapping

Mappers may rename fields, convert declared representations, handle nullable values, map enums, serialize JSON, and assemble application data from loaded relations. They must not change business meaning or calculate business outcomes.

Conversions must preserve the contract's precision, nullability, and valid values. Do not silently truncate numbers, convert missing data to a business default, or guess an unknown enum value. Validate external responses and stored data where their shape cannot be trusted; report incompatible data explicitly.

Generated identifiers or storage timestamps are acceptable when the persistence contract assigns them to the data source. Business dates and derived values must come from the owning rule or use case.

## Ownership and Access Scope

For data scoped to an account, user, or tenant, constrain every relevant read, write, delete, existence check, and count to that scope. A globally unique record identifier does not replace an ownership constraint.

The API must derive access scope from trusted authentication and authorization context, not accept a client-supplied tenant identifier as proof of access. Repositories enforce that supplied scope; domain or application policies decide whether the requested business action is permitted.

Prefer scoped mutations that check ownership as part of the write. When the storage operation cannot express scope, ownership verification and mutation must have a concurrency-safe consistency boundary; a detached check followed by an unrestricted write is insufficient.

Mobile adapters must keep account-specific local data and caches isolated and prevent a later session from receiving a previous account's data. Local scoping and hidden UI controls do not replace server-side access controls. Mobile must never receive server database credentials.

## Queries and Pagination

Translate normalized criteria into source-specific queries and return the contract's declared shape. Lists and their total counts must apply the same filters and ownership scope. Paginated queries need a deterministic order, including a tie-breaker where required.

When a contract promises a consistent snapshot of rows and total count, use a transaction, single query, or equivalent source capability that actually provides that guarantee. Merely wrapping two reads in a transaction does not establish snapshot consistency for every isolation level. If the source cannot provide the promised consistency, change the contract explicitly rather than silently weakening it.

## Transactions and Concurrency

The application operation defines which writes must succeed or fail together. Infrastructure implements that requirement using the established transaction mechanism of the data source.

Keep repository-owned transaction callbacks focused on persistence. They must not introduce business decisions, call unrelated features, or send external notifications. A transaction spanning multiple adapters must be coordinated through an application-owned capability with infrastructure wiring; it must not require one repository to reach into another feature's internals.

Database uniqueness and reference constraints must enforce the relevant storage integrity guarantees. An earlier existence check alone cannot protect against concurrent writes.

If a business decision depends on mutable stored state, its rule still belongs outside the repository, but its read-and-write sequence needs an explicit concurrency strategy. Use an appropriate atomic condition, version check, or transactional capability and report conflicts through the contract. Do not solve a race by relocating business policy into persistence.

An API request sequence or a group of local storage writes must not be described as atomic unless the underlying boundary guarantees it. Mobile operations requiring server-side atomicity must use an API operation that provides it. Add retry, offline synchronization, or compensation behavior only for an explicit requirement, with defined duplicate and conflict handling.

## Error Handling

Translate known technical failures into stable failures defined by the application contract, such as a uniqueness conflict or unavailable data source. Keep the translation local to the adapter and preserve diagnostic information without exposing credentials or sensitive records.

Do not treat every storage exception as a duplicate, missing record, or empty result. Unexpected failures must remain observable. Catch blocks must not choose a new business status, apply fallback business values, or trigger another workflow.

Presentation owns HTTP status codes, UI messages, and navigation. The repository reports what failed; the use case and presentation decide the appropriate application and user-facing response.

## Testing

Test observable persistence behavior, not implementation details. Do not make exact SQL text, ORM method names, mapper invocation counts, or internal call order the test contract.

- Verify that supplied values are preserved through writes and reads, including meaningful nullable and typed conversions.
- Verify that scoped operations cannot read or change another owner's data, including counts and related records.
- Verify duplicate and reference handling, required rollback behavior, and relevant concurrency conflicts against isolated real infrastructure.
- Verify that expected failures have the declared meaning and unknown failures are not reported as success.
- For remote adapters, verify the externally required request and response contract at a controlled HTTP boundary. Use integration checks for claims about actual service compatibility.

Use pure tests for standalone mapping behavior. Use real test storage for source-specific guarantees; mocks asserting that a transaction method was called do not prove atomicity. Keep tests next to the implementation and avoid repeating domain-rule suites in repository tests.

## Implementation Workflow

1. Identify the owning feature and separate persistence work from business decisions.
2. Read the caller's contract and the nearest adapter with a similar responsibility.
3. Define explicit inputs, output shapes, ownership scope, and failure semantics.
4. Implement only the required queries, writes, technical mapping, and consistency safeguards.
5. Verify observable behavior at the appropriate boundary.

Reuse existing client setup and transaction conventions. Add adapters, mapper files, or shared helpers only when the current implementation needs them.
