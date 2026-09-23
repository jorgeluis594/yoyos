---
name: implementation
description: Guide implementation through contextual analysis, case-specific project documentation, continuous development, and validated commits. Use for requests to implement, change, fix, or refactor project code in the API or mobile app.
---

# Implementation

## Steps

1. Analyze the request, relevant code, callers, tests, and applicable `AGENTS.md` instructions. Identify the application and business feature that own the behavior.
2. Read [Application Architecture](../../../docs/architecture.md) completely and adapt the implementation to its responsibility boundaries and dependency direction. It defines the target architecture, not the current scaffolds; apply it to the requested change without migrating unrelated code.
3. Read the additional documents selected by the cases below before changing the corresponding behavior. Follow all applicable rows when a change spans responsibilities.
4. Inspect Git status and preserve unrelated user changes.
5. Inspect the affected application's `package.json`, tooling, and CI configuration to determine its actual validation commands. Do not assume root-level scripts or copy commands from another repository.
6. Implement continuously, reusing existing code and creating only the layers and files the current behavior needs.
7. Add or update behavioral tests and run focused checks while developing, following [Testing Conventions](../../../docs/testing-conventions.md).
8. Regularly evaluate whether the accumulated changes are ready for a commit. When ready, run the affected applications' configured lint, test, and type checks, plus integration checks required by the changed contracts.
9. If the required checks pass, inspect the diff, stage only related changes, and create a concise commit describing their meaning, unless the user requested uncommitted changes. Commit readiness does not authorize pushing or deploying.
10. Continue implementing and repeat the flow until all requirements are complete. Before reporting completion, confirm the final diff is covered by successful checks; rerun checks affected by subsequent changes and report any validation gaps.

## Documentation by case

Paths below are relative to this skill. The documents remain the source of truth; do not duplicate their definitions here.

| Case or definition needed | Read |
| --- | --- |
| Feature ownership, folder structure, layer responsibilities, dependency direction, public exports, shared code, or composition | [Application Architecture](../../../docs/architecture.md) |
| Writing or changing code: functional programming, Result contracts, composition, and available helpers | [Programming Style](../../../docs/programming-style.md) |
| Business types, calculations, normalization, invariants, state transitions, authorization policy, use cases, or search defaults | [Domain Conventions](../../../docs/domain.md) |
| Repositories, database queries, mobile API or local-storage adapters, technical mapping, ownership scoping, pagination, transactions, concurrency, or technical failure translation | [Persistence Conventions](../../../docs/persistence.md) |
| Choosing test placement, scope, assertions, fakes, isolation, integration boundaries, or end-to-end verification | [Testing Conventions](../../../docs/testing-conventions.md) |
| API handlers, mobile screens, hooks, forms, routing, or boundary validation | [Application Architecture — Presentation](../../../docs/architecture.md#presentation) and [Testing Conventions — Presentation](../../../docs/testing-conventions.md#presentation); also read Domain Conventions if business behavior changes |
| Distinguishing business normalization from technical mapping, or deciding who validates a value | [Domain Conventions — Validation and Authority](../../../docs/domain.md#validation-and-authority) and [Persistence Conventions — Responsibility Boundary](../../../docs/persistence.md#responsibility-boundary) |
| A business decision depends on mutable stored state, or several writes must succeed together | [Domain Conventions — Application Use Cases](../../../docs/domain.md#application-use-cases) and [Persistence Conventions — Transactions and Concurrency](../../../docs/persistence.md#transactions-and-concurrency) |

For mobile changes, also follow [apps/mobile/AGENTS.md](../../../apps/mobile/AGENTS.md), including its versioned Expo documentation requirement. Review reports such as `docs/architecture-redundancy-report.md` are audit context, not replacement conventions or instructions to apply their recommendations.

## Validation commands

Run checks from the owning application directory using its declared package manager and available tooling. Reinspect scripts when working; the scaffolds may evolve.

- `apps/api/package.json` currently has a placeholder `test` script that exits with an error and no lint or typecheck scripts. It does not provide a working test suite.
- `apps/mobile/package.json` currently declares `lint`, but no test or typecheck scripts. Confirm that its lint tooling is configured before treating the script as a usable check.
- A missing check is not a passing check. When the requested behavior needs runnable tests, add only the tooling necessary to run them, following Testing Conventions. Report remaining missing or blocked checks explicitly; do not claim full validation or commit with an unresolved required check.

## Commit readiness

Changes are ready for a commit only when:

- They complete a coherent part of the requirements.
- They are understandable and reversible on their own.
- They contain no intentionally incomplete or broken behavior.
- They comply with Application Architecture and the conventions selected for the changed behavior.
- They include the tests needed to validate the behavior, with successful checks covering the final changes.
- Their diff has one clear meaning.
- They exclude unrelated user changes.

If any condition is false, continue implementing without committing. If checks fail because of the changes, fix the failures and rerun the affected checks before committing. If a required check is blocked by an unrelated failure or unavailable infrastructure, report the blocker and validation performed without presenting the check as passed.
