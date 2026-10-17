# Guide for defining architecture in Yoyos

This guide describes how the technical side of a feature is defined from a behavior definition: which use cases exist, which data is stored, how it is typed, which layer does what, how consistency is guaranteed, how features and applications connect, what is tested and what is logged. It does not describe the current state of the code or decisions already made: that comes from the repository memory, from `docs/architecture.md`, `docs/domain.md`, `docs/persistence.md`, `docs/programming-style.md` and from the current documents in `docs/`.

It is used by walking through the steps in order. Each step has rules with an example and, when it helps, what is not done. The examples are illustrative: they show the shape of the decision, not how Yoyos is built today.

Stable context: Yoyos has a web application and API in `apps/core` (Express, React Router, Prisma on PostgreSQL with per-company isolation) and a mobile application in `apps/mobile` (Expo). Both are organized by business features with `domain`, `application`, `infrastructure` and `presentation` layers, and one `composition.ts` per feature. Fallible operations return `Result<T, E>`. Every JSON that crosses a boundary is validated with Zod. Everything else is verified.

---

## Step 1. Start from the code, not the idea

**1.1 The design opens with the verified current state and the gaps.**
Before proposing, list which pieces exist (use case, repository, contract, table, event, screen), where they are and in what state, with the reference commit or branch. Then list the gaps the design closes. A design that does not name what exists proposes things that are already there.
- Example: "`registerMobileMessage` exists in `chats/application`, publishes `message_created` after commit; no use case exists that adds items to an existing order."
- Do not: propose an image upload endpoint when `POST /api/images` already exists.

**1.2 The existing module, pattern and flow are reused as is.**
If a capability already exists (image upload, transaction with lock, event bus, mobile HTTP client, native printing module), it is used with its current usage flow. A new parameter, a special limit or a "for this case" variant needs a written reason; if there is none, it is not added.
- Example: a payment receipt is uploaded with the images API and the payment stores the `imageId`; no dedicated upload is designed.
- Do not: `?purpose=logo` with a different limit just because it is a logo.

**1.3 A library's default behavior wins over a custom adaptation.**
If a library (authentication, bus, ORM) already solves the case with its native flow, that flow is adopted. Adapting it requires a nameable risk the native flow does not cover.

**1.4 What memory or a current document records as discarded is not proposed again.**
Neither under another name nor as "option B". If there is a new reason, it goes to the questions block once, with the reason.

**1.5 When in doubt about the model, compare with a market reference.**
Before choosing between two data models, look at how a mature product in the same domain solves it and note the conclusion in one line.

---

## Step 2. Name the intentions before the infrastructure

**2.1 First list the business use cases; infrastructure is a consequence.**
The document names each complete intention with a business verb: `createOrder`, `reportPayment`, `registerPayment`, `voidPayment`, `setDelivery`, `enableOrderCheckout`. Then the ports, repositories and routes those intentions need are derived.
- Do not: a file tree with ports and implementations without saying which business intention uses them.

**2.2 A use case is a function with three parameters: flat `input`, trusted `access` and `deps`.**
`input` carries only the operation's data. `access` carries the already verified identity and its scope (`{ companyId, userId }` for an authenticated seller; `{ companyId, orderId }` for a public operation on an order); holding an access object does not authorize by itself: the use case verifies ownership and state in persistence. `deps` is a `Readonly<{ … }>` of functions declared next to the use case.

```ts
export type ReportPaymentInput = Readonly<{ paymentId: PaymentId; receiptImageId: ImageId }>;
export type ReportPaymentError = OrderDomainError | PaymentError | Readonly<{ code: "ORDER_NOT_FOUND" | "RECEIPT_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type ReportPaymentDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, ReportPaymentError>>) => Promise<Result<T, ReportPaymentError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, ReportPaymentError>>;
  savePayment: (payment: Payment, companyId: CompanyId) => Promise<Result<null, ReportPaymentError>>;
  clock: () => Date;
}>;
export async function reportPayment(input: ReportPaymentInput, access: BuyerPaymentAccess, deps: ReportPaymentDependencies): Promise<Result<OrderAggregate, ReportPaymentError>>
```

**2.3 Every dependency returns `Result`; valid absence is `ok(null)`.**
No port throws expected errors or returns bare values. The clock and identifier generators come in as dependencies.

**2.4 Ports are named by intention, not by channel or technology.**
`SendPasswordResetLink`, not `SendPasswordResetEmail`; `readImageBytes`, not `fetchFromR2`. The template, the provider and the transport live in infrastructure.

**2.5 Errors are unions of objects with a stable literal `code`.**
The use case returns the union of the domain errors it coordinates plus its own. Consumers decide by `code`, never by the text of `message`. Technical errors are translated to a stable code in the adapter (`PERSISTENCE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE`), without exposing provider details.

**2.6 The use case returns the full aggregate and domain types.**
It returns `OrderAggregate` with `Date` and `Money`, not a fragment nor the HTTP response. Only the presentation layer builds the public projection.

**2.7 An interface is left stable so future modules only add.**
If a total will be fed by payments, deliveries and discounts, the contract exposes `itemsTotal` and `total` from the start and each module adds its part; the signature does not change when the next one arrives.

**2.8 No intermediate states or steps are created to wait for another branch.**
What another branch resolves is integrated at the end on the meeting contract; no "pending cost" or "no rate" state is added in the meantime.

---

## Step 3. Type strongly and validate at runtime

**3.1 No DTOs or aliases: exact types inferred from schemas and assembled in the use case.**
JSON contracts are defined with Zod and typed with `z.infer`. The use case receives validated primitives and builds the domain types with pure functions. There is no DTO layer, no generic mappers and no aliases that repeat a type under another name.
- Do not: `OrderContact` as an alias of `Contact`; `ConfirmOrderOutcome` duplicating a state that already exists.

**3.2 Each new type is justified in one line or not created.**
The document says for each new type why an existing one does not work. A type that only renames, wraps or duplicates is removed.

**3.3 Names and attributes uniform with the existing type in core.**
One concept has one name in core, mobile and contracts (`Order`, not `Sale`; `id`, not `orderId` inside `Order`). Mobile may have its own model with only the fields its screens use, but with core's names.

**3.4 Values with rules are branded types with a parser that returns `Result`.**
`OrderNumber`, `PhoneNumber`, `DispatchDate`, `PeruDistrictCode`: a TypeScript brand plus a `parseX(input): Result<X, E>` function that checks the real rule (a valid calendar date, not just a regular expression). Brands do not replace runtime validation.

**3.5 Variants and absence are expressed with discriminated unions, never with pairs of nulls or sentinels.**
`AgencyAssignment = { kind: "pending" } | { kind: "assigned"; courier; agency }` replaces `courier: null; agency: null`. Unknown data is optional or `null`; never `0`, `""` or a fake date. In a partial update, `undefined` means "do not touch" and `null` means "remove".

**3.6 Writes are bounded to the change.**
A repository receives `Pick<OrderAggregate, "scheduledDispatchDate">` or a specific change type, not `Partial<OrderAggregate>` nor the whole aggregate to "update whatever comes".

**3.7 No `any`, no `as` on external data, no unexhausted discriminants.**
Rows read from the database, remote responses and native module data are validated with a schema before use; invalid stored data is a data error (`INVALID_STORED_DATA`), not an empty result.

---

## Step 4. Put each thing in its layer

**4.1 Domain: pure rules with state as input.**
Calculations, invariants, transitions and parsers live in `domain/` as functions that receive the state and return `Result` with the next state. An aggregate state machine (`orderStateMachine.addReportedPayment(order, payment)`) concentrates the transitions. No clock, no randomness, no I/O.

**4.2 Application: one file per use case, inline dependencies.**
`application/<verb-object>.ts` with the input, error and dependency types and the function. The event types the feature publishes go in `application/events.ts`. Subfolders (`use-cases/`, `ports/`) are created only when volume justifies it.

**4.3 Infrastructure: data access and external services, with strict parsers.**
Prisma repositories, file readers, outgoing HTTP clients, Zod parsers for event payloads (`parseMessageCreated` with `z.strictObject`), translation of technical errors. No business decisions: the repository stores the state it receives, it does not decide the next one.

**4.4 Presentation: incoming HTTP, pages and screens.**
`presentation/api-routes.ts` validates the body with the contract schema, extracts access from the session, calls the use case and translates `code` to an HTTP status. The public projection is built here and validated against the response schema before sending. On mobile, screens, hooks and forms invoke application operations; they do not implement rules.

**4.5 `composition.ts` is the feature's only entry point.**
It assembles the concrete dependencies (company-scoped transaction, repositories, clock, capabilities from other features) and exports the ready-to-use operations. There is no `index.ts`. Other features import `features/<x>/composition.ts` and the types from the file that defines them.

**4.6 Logs are written where the action happens and only once.**
The use case or adapter that knows the result logs the event with its context; a use case is not wrapped just to log, and the same fact is not repeated in two layers. A success summary that depends on the commit waits for the real commit.

**4.7 Between features: public composition, injected capability or event. Never another feature's repository.**
A feature uses another's composed operations (`findSellableVariant` from products) or receives the capability through `deps`. The feature that owns the complete intention coordinates; the other participates.

**4.8 The feature that owns the concept computes or renders; the generic module does not know it.**
A product's QR is generated by products; printing only prints images. A native module or a Go library exposes general operations and knows nothing about products or orders.

---

## Step 5. Split between core, mobile, shared and native

**5.1 Core is the authority; mobile guides and recovers.**
Rules, prices, stock, totals, authorization and per-company isolation are decided in core. Mobile may compute a total to display it, but the only recorded total is core's; the use case compares what the client saw (`expectedTotal`) with the current one and responds `TOTAL_CHANGED`.

**5.2 `shared/` only for what two applications consume.**
`shared/contracts/` holds the Zod schemas for JSON between core and mobile; `shared/result`, `shared/money`, `shared/functional` the common utilities. A schema only the web uses lives in `features/<x>/presentation/schemas.ts`. `shared/` imports no entities or persistence models from any app.

**5.3 Mobile has its own model and does not import core's internal types.**
The mobile HTTP adapter validates the response with the shared contract and converts it to the screen model. Device preferences (chosen printer) are stored in the phone's secure storage; account data is isolated per account.

**5.4 Native and Go are minimal bridges; logic lives once, in TypeScript.**
A Kotlin/Swift module or a Go library exposes general operations (print an image, receive a message) and validates input and output. It does not draw labels, does not persist messages the app already persists, does not decide rules. It is named by the interface it exposes, not by the library it wraps.

**5.5 Secrets and sessions do not leave the device nor go to our own servers.**
An encrypted session lives in the phone's secure storage, is persisted before confirming any operation that modifies it and is never copied to Yoyos. Database credentials never reach mobile.

**5.6 Routes and types without channel or country names when the concept is general.**
`POST /api/messages`, not `/api/whatsapp/messages`, if the message enters through the API and the channel is an attribute. `DeliveryDistrict`, not `PeruDistrict`, if the code can be abstracted from the place. The channel name stays only where the content is specific.

---

## Step 6. Guarantee consistency

**6.1 What must happen together goes in one transaction.**
Confirming a payment, deducting stock and changing the order state are one transaction: everything commits or everything rolls back. Partial states "reconcilable later" are not designed when a transaction avoids them.

**6.2 The lock is chosen per operation to satisfy ACID, without inventing mechanisms.**
If a decision depends on stored mutable state, the read and the write go in a short transaction with whatever lock is needed (aggregate row with `FOR UPDATE`, `UPDATE … WHERE quantity >= n` for stock, optimistic version for configuration). Existing transaction helpers are reused; no new lock system is added.

**6.3 Internal identifiers are UUIDs; human-readable ones are an integer sequence per company.**
The client may generate the UUID of the entity it creates; core validates it as a UUID and uses it as the idempotency key. A visible number is a per-company counter that starts at 1001 and keeps growing; nothing alphanumeric or "clever".

**6.4 Duplicates: an automatic retry returns what exists; a human retry gets a conflict.**
A sync queue, an event or a job that repeats a creation with the same id gets success with the existing result. A person who repeats the action gets 409 with a stable code and the interface links what was already created. No idempotency tables, request fingerprints or extra headers; database uniqueness closes the race.

**6.5 Idempotency in the consumer with table uniqueness, not separate deduplication state.**
Whoever persists checks by stable identity (primary key or unique index) whether it already has it; no record of confirmations or history of what was processed is kept.

**6.6 Frozen snapshots for what was agreed; current for what is instructed.**
What is part of an agreement (address, agency, rate, names) is copied into a Zod-validated JSON inside the aggregate with a discriminated union per variant, and does not change even if the configuration changes. What is an instruction (which account to pay to) is read current.

**6.7 Events after commit; retry from the producer.**
An event is published once the transaction has committed. If publishing fails, the producer (the client that made the POST, the job that retries) repeats the idempotent operation; no outbox or republisher is designed unless explicitly required, with its duplicate strategy.

**6.8 Operational values per environment, never fixed in code.**
Domains, size limits, timeouts and keys go in environment variables with an initial value documented as "adjustable".

**6.9 No backward compatibility while there is no production.**
Check in the repository memory whether there are businesses operating. If there are none, schema changes are applied without data migration or transition period; development data is deleted.

---

## Step 7. Integrate features and applications

**7.1 Between features, a domain event with identifiers, never with bytes.**
`message_created: { companyId, messageId }`; the consumer loads what it needs by id. The event is named by the business fact, not by the channel or the consumer.

**7.2 One event per fact; the consumer lives in its own feature.**
The feature that persists publishes; the one that reacts listens from its `composition.ts` and applies its rules. No secondary events are added to carry what the first one already references.

**7.3 Between mobile and core, a versioned contract in `shared/contracts` and references by id.**
Mobile uploads the image with the images API and sends the `imageId` in the message; core validates that the reference exists and belongs to the company before persisting.

**7.4 What belongs to the system and what belongs to each company are modeled separately.**
A global catalog (`Courier`) and its per-company configuration (`CompanyCourier`) are distinct tables with distinct scope; a company entity carries `companyId` and row-level isolation.

**7.5 Each concept with its own identity gets its own table.**
An order's buyer data is not stored as loose columns on the order if it forms a concept (`OrderBuyer`). Conversely, data that is only an attribute does not get a table.

**7.6 Persist the essential; the ephemeral is not stored.**
A print job, a request already sent or a loaded list is not persisted. The minimum to recover from doubt is stored: the generated id and what the user saw.

---

## Step 8. Define tests and observability as part of the design

**8.1 Tests are written as behavior titles, per level and per application.**
Unit for pure rules and use cases with fakes; integration for repositories, routes and flows with a real database, covering all new behaviors; E2E only on web and only the happy path. Mobile has no E2E. Each title states the situation and the observable result; no implementation is written.
- Example: `test("rejects confirming the checkout when the total changed since the buyer saw it")`.
- Do not: categories ("validation tests") or test bodies in the document.

**8.2 Manual testing is named at the end.**
What can only be verified on a device or with a real service is listed as a pending manual check, with what is observed.

**8.3 Observability is defined as event → level → fields.**
For each critical point (transaction start, business rejection, technical failure, success after commit), write the event name in `snake_case`, the level and the list of fields as JSON with the context for debugging (ids, `stage`, `errorCode`, `durationMs`). No open questions, no dashboard queries. Never personal data, amounts, bodies or credentials; nor a UUID that works as an access link.

---

## Step 9. Split into tasks for agents

**9.1 A task covers a probable flow, not a file.**
Each task leaves something verifiable end to end (migration + use case + route + tests for that flow). Tasks are not split by layer or by file.

**9.2 Blockers are isolated in small tasks to free the rest in parallel.**
What everyone needs (a schema change, a shared type, a contract) is the first task, minimal; the others declare they depend on it and run in parallel.

**9.3 Each task carries scope, out of scope and acceptance criteria.**
Criteria are concrete scenarios with data and an observable result, not categories.

**9.4 Deferred items with real risk go to Todoist and are linked.**
If what is left out can cause loss, duplication or blocking, it is a backlog task. What is only an improvement is listed in the document.

---

## Step 10. Decide what the agent decides and what it asks

The agent decides everything routine on its own and writes it down. It asks only what changes scope, data that is kept, stable public contracts, priorities between branches, security, or contradicts a previous decision. It asks with a recommendation.

### The agent decides and writes it down

- **Names of use cases, types, files and events**, following the existing ones.
- **Shape of dependencies, errors and results** per Step 2.
- **Where each piece lives** per Steps 4 and 5.
- **Transaction and lock of each write** per Step 6, reusing the existing helpers.
- **Zod validations for input, output, rows and events.**
- **Test titles and the fields of each log.**
- **Initial calibration values** (limits, timeouts, pages), marked as "initial value, adjustable" and configurable per environment.
- **Split into tasks and their dependency order.**
- **What is already recorded in the repository memory or in a current document.** If the task contradicts memory, memory prevails and it is noted.
- **Facts verifiable in the code:** whether a use case, a table, a contract exists. It is verified, not asked.

### Requires the founder

- **Technical scope of the first version:** which platforms, which channels, which branch resolves each part, what is deferred.
- **Public contract changes** that other applications or future modules will consume.
- **What is kept and in what shape** when the behavior does not resolve it: snapshot or current, own table or attribute, retention.
- **Additional protection** (expiries, tokens, encryption) when there is no named risk that requires it.
- **A data model with two valid readings** (for example, rate per zone or per option), presenting both with consequences.
- **Anything that contradicts a previous decision.** The contradiction is exposed and asked about; it is never reintroduced on the agent's own initiative.

---

## Step 11. Present the result

**11.1 The documents are delivered complete, with routine decisions made and visible.**
Neither a skeleton nor a list of options is delivered. Every decision the founder might want to change appears under "Decided unless objected".

**11.2 Questions go in a single block, numbered, with a recommendation.**
Each question carries the context in one line, the recommended option first with its reason, the alternatives and the consequence of each in data, contracts or effort, so it can be answered with a number.

```
Questions (answer with the option number):

1. Does the delivery rate depend on the zone or on the option within the zone?
   (1) On the option. Recommended: allows several rates per zone without duplicating districts.
   (2) On the zone. Simpler, but a zone with two couriers requires two identical zones.

Decided unless objected:
- `OrderBuyer` is its own table with an optional `contactId`.
- The order counter starts at 1001 per company.
```

**11.3 A founder question like "what does X do?" or "what is X for?" is an objection.**
Answer in two lines and offer the version without X. X is not defended.

**11.4 A short message with two readings is rephrased and the agent asks which one it is.**
It is the only question asked before writing the document.
