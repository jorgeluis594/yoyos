# Repository Guidelines

## Project Structure & Module Organization

Yoyos manages sales for businesses selling through social media.

- `apps/core/`: React web application and Express server; routes/components in `app/`, business features in `src/features/`, database schema and migrations in `prisma/`.
- `apps/mobile/`: Expo/React Native application; routes in `src/app/`, features in `src/features/`, reusable UI in `src/components/ui/`, images/fonts in `assets/`.
- `landing/`: Astro static marketing site (independent package with its own lockfile and CI job); pages in `src/pages/`, copy in `src/content/`, build-time configuration from `PUBLIC_*` variables.
- `shared/`: cross-application contracts, money utilities, and Result helpers.
- `docs/`: architecture, programming, persistence, and testing guidance. Older `apps/api/` references describe the current core backend.

Keep domain rules pure, application dependencies explicit, and persistence/network operations in infrastructure adapters.

## Build, Test, and Development Commands

Use Node.js 24 and pnpm 12.5.1 to match CI; `mise.toml` currently pins Node 22. Install dependencies with `pnpm --dir <directory> install --frozen-lockfile`, first for `shared`, then each application.

- `docker compose up --build`: start the web app and PostgreSQL at `localhost:${WEB_PORT:-3000}` (`WEB_PORT` is set in the root `.env` of a worktree).
- `pnpm --dir apps/core dev`: build and watch the server locally; requires configured services.
- `pnpm --dir apps/core build`: create the web production build.
- `pnpm --dir apps/mobile start`: start Expo.
- `pnpm --dir <app> lint` and `pnpm --dir <app> typecheck`: run ESLint and TypeScript checks; replace `<app>` with `apps/core` or `apps/mobile`.
- `scripts/ci.sh [--fast] [parent-branch]`: run the CI checks locally on what the branch changed against its parent (default `main`); `--fast` skips core integration and E2E. Use it to validate before committing.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, descriptive kebab-case filenames, PascalCase components/types, and camelCase functions/variables. Match surrounding quote style. Follow `docs/programming-style.md`: small functions, plain data, explicit types, Zod validation at JSON boundaries, and `Result` for fallible operations. Reuse shared helpers and existing components.

## Testing Guidelines

Core uses Vitest; mobile uses Jest and React Native Testing Library. Colocate `.test.ts`/`.test.tsx` files; core browser journeys belong in `tests/e2e/*.spec.ts` and use Playwright through Vitest.

Run `pnpm --dir apps/core test:unit` or `pnpm --dir apps/mobile test`. From `apps/core`, run `sh scripts/run-tests.sh integration` or `sh scripts/run-tests.sh e2e`; these require Docker and `psql`, plus Chromium for E2E. Use isolated test data. Cover meaningful outcomes and failure boundaries; no numeric coverage target is prescribed.

## Commit & Pull Request Guidelines

Use concise imperative commit subjects, following history: “Add manual POS sales in core”. Keep changes focused. PRs should explain behavior changes, link relevant issues, report checks run, and include screenshots for UI changes. Ensure CI passes.

Run the `happy-memory-recall` skill before designing or implementing. Before reporting a task as complete, run the `happy-memory-maintainer` skill when the work changed business rules, domain validation, contracts, or recorded decisions, and state the outcome (created, updated, or no change) in the final report.

## Security & Database Changes

Keep credentials out of Git. Preserve company isolation and restricted database roles. Follow `.agents/skills/database-migrations/SKILL.md` for schema changes; never delete persistent volumes during upgrades.
