---
name: implementation
description: Guide implementation through contextual analysis, case-specific project documentation, continuous development, and validated commits. Use for requests to implement, change, fix, or refactor project code in the API or mobile app.
---

# Implementation

## Steps

1. Use [Happy Memory Recall](../happy-memory-recall/SKILL.md) to retrieve repository memories relevant to the request. Then analyze the request, relevant code, callers, tests, and applicable `AGENTS.md` instructions. Identify the application and business feature that own the behavior, and verify any recalled context against current code and documentation.
2. Read [Application Architecture](../../../docs/architecture.md) completely and adapt the implementation to its responsibility boundaries and dependency direction. It defines the target architecture, not the current scaffolds; apply it to the requested change without migrating unrelated code.
3. Read the additional documents selected by the cases below before changing the corresponding behavior. Follow all applicable rows when a change spans responsibilities.
4. Inspect Git status and preserve unrelated user changes.
5. Inspect the affected application's `package.json`, tooling, and CI configuration to determine its actual validation commands. Do not assume root-level scripts or copy commands from another repository.
6. Identify small logical units in dependency order, each independently reviewable and validatable. Implement them through the [Commit workflow](#commit-workflow), reusing existing code and creating only the layers and files the current behavior needs. For internal code imports, use only `@shared/*`, `@core/*`, or `@mobile/*`, according to the owning module. Never use relative paths, absolute paths, or `@/*`. Configure any missing alias in the affected application's tooling before using it.
7. Add or update behavioral tests and run focused checks while developing, following [Testing Conventions](../../../docs/testing-conventions.md). In `apps/core`, use Vitest to define and run every unit, integration, and end-to-end test, and use its `expect` for general assertions.
8. Before reporting completion, verify that every completed unit is committed and that successful checks cover the final changes; report commit IDs and any remaining blockers.

## Guardrails

- Always create commits during implementation unless the user explicitly requests uncommitted changes. Never accumulate multiple logical units into one final commit or wait until the entire feature is finished to split it into commits. A shared feature goal does not make all its changes one commit; a single commit is appropriate only when the task contains one logical unit.
- Use `Result` by default for expected failures. Do not throw inside a `try` only to catch and rethrow the same exception in that function; use `Result` or an early return. Use `try/catch` only when an exception must be handled and cannot be controlled with `Result`.
- Define every port operation's return as `Result<T, E>` or `Promise<Result<T, E>>` in its domain- or application-owned dependency signature, whether the contract is named or declared inline in a use case. Infrastructure adapters must implement that signature: represent valid absence as `ok(null)` and declared failures as `err(...)`, rather than returning bare values or throwing expected errors.
- In `apps/core` tests, do not use Node.js's native test runner or assertion library: `node:test`, `node:assert`, `node:assert/strict`, or their unprefixed equivalents. Do not substitute another test runner or general assertion library for Vitest.
- In `apps/core`, Playwright may control the browser and assert on pages and locators in end-to-end tests; Vitest must still define and run those tests.

## Documentation by case

Paths below are relative to this skill. The documents remain the source of truth; do not duplicate their definitions here.

| Case or definition needed | Read |
| --- | --- |
| Feature ownership, folder structure, layer responsibilities, dependency direction, public exports, shared code, or composition | [Application Architecture](../../../docs/architecture.md) |
| Writing or changing code: functional programming, Result contracts, composition, and available helpers | [Programming Style](../../../docs/programming-style.md) |
| Core web frontend changes, including forms, form state, and client-side validation | [Frontend Development](../../../docs/frontend-development.md) |
| Business types, calculations, normalization, invariants, state transitions, authorization policy, use cases, or search defaults | [Domain Conventions](../../../docs/domain.md) |
| Repositories, database queries, mobile API or local-storage adapters, technical mapping, ownership scoping, pagination, transactions, concurrency, or technical failure translation | [Persistence Conventions](../../../docs/persistence.md) |
| Choosing test placement, scope, assertions, fakes, isolation, integration boundaries, or end-to-end verification | [Testing Conventions](../../../docs/testing-conventions.md) |
| API handlers, mobile screens, hooks, forms, routing, or boundary validation | [Application Architecture — Presentation](../../../docs/architecture.md#presentation) and [Testing Conventions — Presentation](../../../docs/testing-conventions.md#presentation); also read Domain Conventions if business behavior changes |
| Implementing business validation with Zod, distinguishing business normalization from technical mapping, or deciding who validates a value | [Domain Conventions — Validation and Authority](../../../docs/domain.md#validation-and-authority) and [Persistence Conventions — Responsibility Boundary](../../../docs/persistence.md#responsibility-boundary) |
| A business decision depends on mutable stored state, or several writes must succeed together | [Domain Conventions — Application Use Cases](../../../docs/domain.md#application-use-cases) and [Persistence Conventions — Transactions and Concurrency](../../../docs/persistence.md#transactions-and-concurrency) |

For mobile changes, also follow [apps/mobile/AGENTS.md](../../../apps/mobile/AGENTS.md), including its versioned Expo documentation requirement. Review reports such as `docs/architecture-redundancy-report.md` are audit context, not replacement conventions or instructions to apply their recommendations.

## Validation commands

Run checks from the owning application directory using its declared package manager and available tooling. Reinspect scripts when working; the scaffolds may evolve.

- `apps/core/package.json` declares `test:unit`, `test:integration`, and `test:e2e` using Vitest, plus `lint` and `typecheck`.
- `apps/mobile/package.json` declares `test` using Jest with `jest-expo`, plus `lint` and `typecheck`. The Vitest requirement applies to `apps/core`.
- When the requested behavior needs runnable tests, add only the tooling necessary to run them, following Testing Conventions.

## Commit workflow

Repeat this cycle for each logical unit before starting the next:

1. Complete one coherent, independently understandable and reversible part of the requirements, including its tests and related documentation. Follow Application Architecture and the applicable conventions; leave no intentionally incomplete or broken behavior. Adjust unit boundaries when dependencies require it, without absorbing unrelated work.
2. Run the affected applications' configured lint, test, and type checks, plus integration checks required by changed contracts. Fix failures caused by the changes and rerun checks affected by subsequent edits. Missing or blocked required checks prevent the commit: report the blocker and validation performed, and do not claim completion or accumulate further units behind it.
3. Inspect the diff for one clear purpose, stage only that unit's changes, and create the commit immediately. Use a concise imperative subject describing the behavior, without prefixes such as `feat:` or `fix:`. Exclude unrelated user changes.

Committing does not authorize pushing or deploying. If the user requested uncommitted changes, apply the same unit boundaries and validation without staging or committing.
