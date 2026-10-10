---
name: testing
description: Write, place, and run tests for the core API/web app and the Expo mobile app. Use when adding or changing tests, choosing test placement, scope, fakes, or isolation, selecting a test runner, or running unit, integration, mobile, or end-to-end checks.
---

# Testing

Paths below are relative to this skill. [Testing Conventions](../../../docs/testing-conventions.md) is the source of truth; read it completely before writing or changing tests and do not duplicate its definitions elsewhere.

## Steps

1. Identify the application and the feature layer that own the behavior (domain, application, infrastructure, presentation, or composition). Place the test next to the implementation it verifies, following the file hierarchy and layer responsibilities in [Testing Conventions](../../../docs/testing-conventions.md).
2. Add the smallest test that proves the rule or reproduces the defect. A regression test must fail without the fix. Cover additional boundaries or failures only when they carry a distinct correctness risk.
3. Assert observable contracts and effects, not implementation structure. Supply dependencies explicitly with small local fakes; use isolated real infrastructure when the behavior depends on it.
4. Run the affected checks with the commands below and broaden the run when shared behavior or integration changes justify it.

## Runners and guardrails

- In `apps/core`, use Vitest to define and run every unit, integration, and end-to-end test, and use its `expect` for general assertions. Do not use `node:test`, `node:assert`, `node:assert/strict`, their unprefixed equivalents, or another test runner or general assertion library. Playwright may control the browser and assert on pages and locators in end-to-end tests; Vitest must still define and run those tests.
- In `apps/mobile`, use Jest with `jest-expo` and React Native Testing Library. Prefer accessible labels and roles over component internals or layout snapshots.
- Tests must run independently of order and of other tests' data. Control time, identifiers, and external responses; restore globals and mocks after each test; await observable completion instead of adding delays.
- Integration and end-to-end tests use dedicated test resources, clean up their data, and never use production data or credentials.
- Do not add tests solely for exports, trivial forwarding functions, or static markup. Avoid large snapshots and coverage targets.
- Do not create tests for database migrations. Migrations are generated with Prisma CLI and reviewed through the [Database Migrations](../database-migrations/SKILL.md) skill; verify the resulting schema behavior through infrastructure tests of the adapters that use it, not by testing migration files, migration SQL, or schema drift.
- Add test tooling only when runnable tests require it. Reinspect each application's `package.json` and CI configuration before assuming a command exists.

## Commands

Run from the repository root. Scripts print `Todo OK` on success and failure diagnostics otherwise; `--silent` suppresses pnpm's banner.

| Suite | Command | Requirements |
| --- | --- | --- |
| Core unit | `pnpm --silent --dir apps/core test:unit` | None |
| Core integration | `pnpm --silent --dir apps/core test:integration` | Docker and `psql` |
| Core end-to-end | `pnpm --silent --dir apps/core test:e2e` | Docker, `psql`, and Chromium |
| Mobile | `pnpm --silent --dir apps/mobile test` | None |

All scripts delegate to `apps/core/scripts/run-tests.sh`; pass extra arguments to focus on specific files, for example `pnpm --silent --dir apps/core test:unit src/features/orders`.
