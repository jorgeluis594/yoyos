# Domain Conventions

## Purpose

Business rules belong to the feature that owns the business concept. Keep those rules pure, coordinate operations through application use cases, and leave technical data access and platform interaction at their respective boundaries.

These conventions apply to both the API and the Expo mobile app. Follow [Application Architecture](architecture.md), keep adapters within [Persistence Conventions](persistence.md), and verify behavior according to [Testing Conventions](testing-conventions.md).

## File Hierarchy

Use this structure within the owning application:

```text
src/features/<feature>/
├── domain/
│   ├── order.ts                    # Business types and construction rules
│   ├── rules.ts                    # Calculations, invariants, and state guards
│   ├── rules.test.ts               # Observable rule behavior
│   └── errors.ts                   # Business failures, when needed
├── application/
│   ├── use-cases/
│   │   ├── create-order.ts         # One complete application intention
│   │   └── create-order.test.ts
│   └── ports/
│       └── order-repository.ts     # Required external capability
├── infrastructure/
│   └── order-repository.ts         # Technical adapter
├── presentation/
│   └── schemas.ts                  # Transport or form input validation
└── index.ts                        # Deliberate public feature exports
```

Filenames illustrate ownership, not required boilerplate. Keep a few related rules together; split them into descriptive files when their size or independent responsibilities justify it. Omit unused files. Small application operations may live in `application/service.ts`, and small dependency contracts may be declared inline.

## Feature Ownership

Choose the feature by the business concept whose behavior changes. Rules about an order belong to orders, even when a screen or another feature needs their result.

- Keep business vocabulary, types, and rules within the owning feature.
- Place coordination in the application layer of the feature that owns the complete intention.
- Use another feature's deliberate public exports or an explicitly supplied capability. Do not import its private rules, repositories, or persistence models.
- Keep dependencies between features acyclic.
- Move code to `shared/` only when it is reused across features and has no business owner. A rule does not become generic merely because several callers need it.

API and mobile follow the same ownership model without requiring identical use cases or shared runtime code. Share pure rules only when both applications genuinely need the same semantics and can maintain them together.

## Pure Domain Rules

Domain functions own calculations, builders, business normalization, guards, transitions, and invariants. A function must produce the same result for the same explicit inputs without reading or writing external resources.

- Use plain data and functions by default. Do not require entity classes, inheritance, or a generic domain framework.
- Do not import HTTP frameworks, UI libraries, navigation, database clients, storage SDKs, or concrete adapters.
- Receive relevant state as input. Do not load it from a repository inside a domain function.
- Receive changing values such as time or generated identifiers explicitly when a rule depends on them. Do not read a clock, random source, environment variable, or mutable global state inside the rule.
- Do not mutate caller-owned inputs or hide side effects in constructors, getters, guards, or normalization helpers.
- Define units, precision, rounding, and boundary behavior when they affect a calculation's business meaning.

Business normalization changes a value according to a rule, such as canonicalizing a business identifier. Technical mapping changes representation, such as converting a stored value to the declared application type. The former belongs here; the latter belongs in infrastructure.

## Application Use Cases

A use case represents one complete intention, such as creating an order or searching an order history. It coordinates pure rules and supplied external capabilities without becoming tied to an entry point.

The usual flow is:

```text
Plain input and trusted context
    → load required state through supplied capabilities
    → evaluate domain rules
    → request the required persistence or external effects
    → return the application outcome
```

Receive dependencies explicitly through parameters or ordinary composition. Declare only the capabilities the operation needs. Do not construct concrete clients or repositories inside a use case, and do not pass UI hooks, HTTP request/reply objects, or navigation objects into it.

Validate applicable invariants before issuing writes. Rejection must not leave unintended effects behind. When validity depends on mutable persisted state, coordinate the consistency strategy described in the persistence guide; a successful rule check followed by an unprotected write is not sufficient.

An operation may coordinate other features through their public capabilities, but must not bypass their ownership by modifying their storage directly. Introduce workflow machinery only when the operation actually requires it.

## Validation and Authority

| Boundary | Responsibility |
| --- | --- |
| Presentation schema or parser | Input shape, types, required fields, and transport-specific coercion |
| Domain | Business normalization, valid values, calculations, permitted state transitions, and business policies |
| Application | Load the required context, apply domain rules, enforce operation-level policy, and coordinate effects |
| Infrastructure | Technical representation, access scoping, reference and uniqueness constraints, and external data integrity |

Use cases must enforce their business contract independently of the entry point. Presentation validation must not be the only protection for business invariants.

The API must establish trusted identity and enforce authorization and authoritative rules independently of mobile. A mobile guard may explain why an action is unavailable, but cannot prove that the server should permit it. Keep identity acquisition outside pure rules and supply the trusted facts needed to evaluate policy.

## Searches and Listings

Model a business search as an application operation. Presentation parses transport-specific values; pure domain or application helpers validate and normalize search criteria according to their meaning.

Define accepted filters, default sorting, pagination limits, date ranges, and invalid-input behavior before calling the adapter. Keep these choices deterministic and testable. Domain-specific filter rules belong in domain; general operation defaults may remain in application.

Pass normalized criteria and trusted scope to infrastructure. Repositories translate criteria into queries; they must not interpret URL parameters, invent defaults, or silently repair invalid business input. Empty results and failed searches must remain distinguishable.

## Outcomes and Functional Composition

Expected business rejection is part of an operation's public contract. Represent success and expected failure explicitly and consistently, using plain result data with stable failure identifiers where callers need to distinguish outcomes. Domain failures must not contain HTTP statuses, navigation actions, or UI copy.

Use existing result conventions when available. This document does not assume that a `response<T>` type or helpers such as `pipeAsync` already exist. A small discriminated result type and ordinary control flow are sufficient; do not introduce a functional utility library just to express a sequence of operations.

When composing fallible steps, stop dependent work on failure. For collection operations, define whether failure rejects the complete operation or returns explicit per-item outcomes; do not silently discard failures or present partial results as complete success.

Infrastructure translates known technical failures into the application contract. Application code may interpret those failures according to the operation, but must not disguise unexpected exceptions as ordinary business rejection. Presentation translates outcomes into API responses or mobile feedback.

## Testing

Test observable behavior rather than implementation details. Keep tests next to the rule or use case that owns the behavior.

- Test pure rules with explicit inputs and expected outputs or failures. Cover meaningful boundaries, invalid states, calculations, and transitions.
- Test use cases with small supplied fakes, covering success, expected rejection, and required observable effects. Verify that rejected operations leave state unchanged where the contract requires it.
- Test search normalization for invalid filters, defaults, pagination, and ranges according to the declared contract.
- Do not assert which private helper ran, how many internal functions were called, or the incidental order of implementation steps.
- Verify persistence-specific guarantees with infrastructure tests, not domain fakes. Avoid repeating the same business-rule cases through adapters and screens.

Domain and application tests must not require a running server, rendered UI, network, or database. Control variable inputs such as time explicitly instead of relying on global test patches.

## Implementation Workflow

1. Identify the owning feature and read the related types, rules, and callers.
2. Define the intended behavior, inputs, outcomes, and invariants.
3. Implement the necessary pure rules and their focused behavioral checks.
4. Compose the use case with minimal, explicit dependencies.
5. Implement required adapters and connect presentation without moving rules into either layer.
6. Verify success, meaningful rejection, and any consistency requirements at the layer that owns them.

Reuse existing rules and patterns. Add public exports, dependency contracts, shared helpers, or additional files only when the current behavior needs them.
