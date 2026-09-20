# Testing Conventions

## Purpose

Tests must follow the feature and layer boundaries defined in [Application Architecture](architecture.md). These conventions apply to both the API and the Expo mobile app, regardless of their test runner.

Keep each test close to the behavior it verifies. When a test fails, its location should identify the feature and layer responsible for that behavior.

## File Hierarchy

Use this structure within either `apps/api/` or `apps/mobile/`:

```text
src/features/<feature>/
├── domain/
│   ├── rules.ts
│   └── rules.test.ts
├── application/
│   └── use-cases/
│       ├── create-order.ts
│       └── create-order.test.ts
├── infrastructure/
│   ├── order-repository.ts
│   └── order-repository.test.ts
└── presentation/
    ├── schemas.ts
    └── schemas.test.ts
```

Presentation tests follow the platform-specific files they exercise:

```text
# API
src/features/orders/presentation/
├── routes.ts
└── routes.test.ts

# Mobile
src/features/orders/presentation/
├── screens/
│   ├── create-order-screen.tsx
│   └── create-order-screen.test.tsx
└── hooks/
    ├── use-create-order.ts
    └── use-create-order.test.ts
```

Apply the same rule to `application/service.ts`, shared utilities, generic UI components, and shared infrastructure: place the test next to the implementation. Use `.test.ts` for non-JSX tests and `.test.tsx` when the test uses JSX.

Complete user journeys that span features or exercise a running application belong in the owning application's `tests/e2e/`, for example `apps/mobile/tests/e2e/create-order.<runner-extension>`. Use the chosen runner's file format there. Do not move ordinary feature tests into a central test directory.

These trees illustrate placement, not a requirement to create a test for every file or an empty test folder for every layer.

## Responsibilities by Layer

| Layer | What to verify | Dependency boundary |
| --- | --- | --- |
| Domain | Business rules, calculations, parsers, guards, invariants, and state transitions | Plain inputs; no server, UI, network, or database |
| Application | Use-case outcomes, expected failures, and required side effects | Supply small fake repositories or external capabilities |
| Infrastructure | Mapping, queries, persistence, request serialization, scoping, duplicates, transactions, and relevant technical failures | Exercise the adapter; use isolated real infrastructure when verifying source-specific behavior |
| Presentation | Boundary validation and translation between user or transport input and application outcomes | Supply controlled application operations when testing presentation in isolation |
| Composition and entry points | Dependency wiring and critical route or startup behavior | Focused integration or smoke tests; end-to-end tests for complete journeys |

### Domain and Application

Test rules in the layer that owns them. Cover meaningful success cases, boundaries, and expected failures without repeating every domain case through a use case or screen.

Supply application dependencies explicitly, as production composition does. Keep fakes small and local. Assert outcomes and observable effects, such as a rejected operation leaving persistence unchanged, rather than internal helper calls or incidental call order.

### Infrastructure

Pure mapping functions can be tested without external resources. Database constraints, query behavior, and transaction rollback must be verified against an isolated test database; an in-memory fake cannot prove them.

For mobile adapters, verify request construction, response mapping, local persistence behavior, and failure translation as applicable. A controlled HTTP or storage boundary is appropriate for adapter logic. Claims about real service compatibility or platform storage behavior require an integration check against that boundary.

### Presentation

API tests should cover relevant request validation, authentication and authorization enforcement, response bodies, and status mapping. Test server-side access controls even if the mobile app hides the corresponding action.

Mobile tests should exercise meaningful user interactions and visible outcomes, including loading, validation, success, and failure states where the feature owns them. Prefer accessible labels and roles over component internals or layout snapshots.

Test a hook separately when it has behavior that benefits from an isolated check. Do not duplicate the same scenarios in hook, component, and screen tests by default.

### Composition and End-to-End Flows

Keep routing and bootstrap tests focused on wiring. A thin route that delegates to a feature screen does not need a duplicate screen suite.

Use end-to-end tests for critical journeys and integration risks that smaller tests cannot establish. An API smoke test or a mobile test backed by fake responses must not be described as proof of the complete mobile-to-API flow.

## Determinism and Isolation

- Tests must run independently and must not rely on execution order or data left by another test.
- Control changing inputs such as time, generated identifiers, and external responses when they affect assertions.
- Use small, explicit test data. Extract fixtures or helpers only when actual reuse justifies them.
- Integration tests must use dedicated test resources, clean up their data, and close clients or connections they create. Never use production data or credentials.
- Await observable completion instead of adding arbitrary delays. Restore modified global state and mocks after each test.
- Keep network and device requirements explicit so fast domain and application tests remain runnable without them.

## Scope and Workflow

1. Identify the layer that owns the behavior being changed.
2. Add the smallest test that proves the rule or reproduces the defect. A regression test should fail without the fix.
3. Cover additional boundaries or failures when they carry a distinct correctness risk.
4. Run the affected tests and the application's required checks. Broaden the run when shared behavior or integration changes justify it.

Test observable contracts, not implementation structure. Do not add tests solely for exports, trivial forwarding functions, or static markup. Avoid large snapshots and coverage targets that reward assertions without meaningful behavior.

Use each application's configured tooling and scripts. These conventions do not prescribe a test framework or imply that runners, commands, or CI checks are already configured. Add tooling only when implementing runnable tests requires it.
