# Application Architecture

## Purpose

Organize the API and Expo mobile app by business features with the same responsibility boundaries, dependency rules, and feature hierarchy. Framework entry points and technical adapters differ by platform; business logic remains independent of them. Read these guidelines when planning, implementing, or refactoring. They define the target architecture, not the current scaffolds.

## Repository Hierarchy

```text
docs/
└── architecture.md                  # Shared architecture guidelines
shared/
├── result.ts                       # Cross-app Result types
└── result.test.ts                  # Shared type contract checks
apps/
├── api/
│   └── src/
│       ├── app.ts                   # Application creation and composition
│       ├── server.ts                # Process startup and shutdown
│       ├── infrastructure/          # Shared connections and client setup
│       ├── features/                # Business features
│       └── shared/                  # Reused code without a business owner
└── mobile/
    └── src/
        ├── app/                     # Expo routes, layouts, and composition
        ├── infrastructure/          # Shared clients and platform setup
        ├── features/                # Business features
        ├── shared/                  # Reused code without a business owner
        └── components/
            └── ui/                  # Generic presentation components
```

## Feature Hierarchy

Use business names such as `orders`, `inventory`, or `accounts`. Do not group unrelated business operations under technical feature names such as `services` or `managers`.

Feature responsibilities follow this hierarchy:

```text
features/
└── orders/
    ├── domain/                      # Business types, rules, and errors
    │   ├── order.ts
    │   ├── rules.ts
    │   └── errors.ts
    ├── application/                 # Application operations and dependencies
    │   ├── use-cases/
    │   │   └── create-order.ts
    │   └── ports/
    │       └── order-repository.ts
    ├── infrastructure/              # Feature-specific data and service adapters
    │   └── order-repository.ts
    ├── presentation/                # Platform input and output
    │   └── schemas.ts
    └── index.ts                     # Public feature exports, when consumed externally
```

These filenames illustrate responsibilities, not mandatory boilerplate. Create only required folders, files, and layers; do not add generic frameworks for hypothetical needs. For a small feature, application operations may live in `application/service.ts`; split them into `application/use-cases/` when independent operations or file size justify it. Do not create both merely to forward calls.

Use descriptive filenames in kebab case. Keep tests next to the behavior they verify, for example `rules.test.ts` or `create-order.test.ts`.

## Layers and File Ownership

### Domain

`domain/` owns business concepts, calculations, invariants, state transitions, and business errors. Rules must be pure and deterministic; provide changing values such as the current time as input when needed.

Domain code must not import UI libraries, server frameworks, database clients, storage SDKs, or other feature layers. Use plain data and functions by default. Add classes or value objects only when they serve a concrete need.

### Application

`application/` owns use cases: complete application intentions such as creating an order or loading an order history. A use case coordinates domain rules and the external capabilities it needs, accepts plain input, and returns plain output or meaningful application failures.

Application code must not construct concrete repositories or import HTTP request/reply objects, UI hooks, navigation objects, or technical clients.

`application/ports/` holds contracts for supplied repositories or external capabilities when named contracts are useful. A small dependency may be described inline with the use case. A port does not require a class, generic base repository, or dependency injection framework.

### Infrastructure

`features/<feature>/infrastructure/` implements the data access and external capabilities required by that feature. It owns queries, persistence, remote requests, serialization, source-specific mapping, and technical error translation.

```text
# API implementation
features/orders/infrastructure/
└── order-repository.ts              # Database access

# Mobile implementation
features/orders/infrastructure/
└── order-repository.ts              # API access or local persistence
```

Add separate adapter files or subdirectories only when multiple real sources require them. Repositories must not decide business policy, orchestrate business workflows, render UI, navigate, or produce HTTP responses.

Application-wide `src/infrastructure/` configures shared technical resources such as database connections, HTTP clients, storage, and logging. Feature-specific queries and endpoints belong in the feature adapter, not in shared client setup.

### Presentation

`presentation/` adapts platform input to use-case input and maps outcomes to platform output. It owns boundary validation and platform interaction, with different files in each application:

```text
# API presentation
features/orders/presentation/
├── routes.ts                        # HTTP handlers and response mapping
└── schemas.ts                       # Request and response validation

# Mobile presentation
features/orders/presentation/
├── screens/
│   └── create-order-screen.tsx       # Feature screen and user interaction
├── components/
│   └── order-form.tsx               # Feature-specific UI
├── hooks/
│   └── use-create-order.ts          # Loading, errors, and operation invocation
└── schemas.ts                       # Form and boundary validation
```

Screens, hooks, and handlers must invoke application operations for business behavior. They must not query databases, call business endpoints directly, or implement domain rules. UI-only behavior, such as expanding a panel, stays in presentation and does not need a use case.

### Application Entry Points and Composition

API `app.ts` creates the application, configures infrastructure, and registers feature routes. `server.ts` owns process lifecycle. Framework plugins may implement registration and resource lifecycle without moving business logic into plugins.

Mobile `src/app/` owns routing, layouts, providers, and application composition. Route files delegate feature-specific UI to screens in `features/<feature>/presentation/screens/`.

Composition creates concrete adapters, supplies them explicitly to use cases through function parameters or ordinary composition, and exposes those operations to presentation. This wiring belongs at application startup, root setup, or feature registration, not inside individual request handlers or screen render logic. Use a separate composition file only if the setup grows enough to need it.

## Dependency Direction

```text
presentation ──→ application ──→ domain
                       ↑
infrastructure ────────┘

composition ──→ presentation / application / infrastructure
```

The arrows describe allowed source dependencies, not runtime flow (entry point → use case → supplied adapter → data source). Application must not import concrete adapters.

- Domain has no dependency on other feature layers.
- Application may depend on domain.
- Infrastructure implements application contracts and may use domain types for mapping.
- Presentation consumes application operations and their data contracts.
- A feature must not import another feature's internal files. Cross-feature access uses deliberate exports from its `index.ts` or an explicitly supplied capability.
- Feature dependencies must remain acyclic. The feature owning an operation coordinates its dependencies.

Export only what other features or application entry points actually need. Do not expose repositories or technical clients through public exports just to bypass a boundary.

## Shared Code

Use a root-level `shared/`, alongside `apps/`, for types and code shared across applications. Each application's `src/shared/` holds code shared only within that app. Keep code in its owning feature whenever possible; move it to `shared/` only when multiple features or apps use it and it has no business owner. Generic UI primitives belong in `components/ui/`; feature-specific components stay in feature presentation.

In `apps/core`, authentication infrastructure (Better Auth, its client, and Prisma) belongs in `src/shared/`. The `User` entity belongs in its own `features/users/` module.

Do not use shared folders as a destination for unclassified code. Result types live in the root `shared/result.ts`; both apps import them with `import type { Result } from "@shared/result"`. Shared types use `import type` and must not depend on an application's framework or persistence models. Neither app imports the other's source. Feature entities remain in their owning feature.

## Validation, Security, and Failures

Validate external input at trust boundaries. Presentation validates request or form structure; domain and application code enforce business invariants. Adapters validate external service or stored data where its shape cannot be trusted. Static types do not replace runtime validation.

The API must independently enforce authentication, authorization, and authoritative business rules. Mobile validation provides user feedback and cannot serve as a security boundary. Database credentials and server secrets must never be supplied to mobile.

Application failures must describe the failed operation without embedding HTTP statuses, navigation actions, or UI messages. Presentation maps them into appropriate responses or user feedback. Unknown failures must remain observable and must not be silently converted into success.

For operations requiring atomic writes, the use case defines the consistency requirement and infrastructure implements it through the data source's transaction capabilities. A sequence of mobile requests cannot guarantee server-side atomicity. Add retries or offline synchronization only with an explicit requirement and a strategy for duplicates and failures.

## Implementation Workflow

1. Identify the business feature that owns the behavior.
2. Add or update domain rules where the behavior requires them.
3. Define the application operation and its minimal dependencies.
4. Implement the necessary infrastructure adapters.
5. Connect the operation through presentation and application composition.
6. Test each behavior in the layer that owns it.

Verify domain rules and use cases without starting a server or rendering UI. Test adapters against their actual data-access behavior and presentation for input/output translation where needed.

Reuse existing code, standard library functions, native capabilities, and installed dependencies before adding structure.
