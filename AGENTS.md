# Repository Guidelines

## Project Structure & Module Organization

Yoyos is a sales management system with two applications:

- `apps/core/`: React Router web UI in `app/`; Express API and business features in `src/`; Prisma schema and migrations in `prisma/`.
- `apps/mobile/`: Expo/React Native app; routes in `src/app/`, features in `src/features/`, reusable UI in `src/components/ui/`, and assets in `assets/`.
- `shared/`: cross-application contracts, Result helpers, and money utilities, imported through `@shared/*`.
- `docs/`: architecture, programming style, testing, and persistence guidance.

Organize features into domain, application, infrastructure, and presentation layers. Keep domain rules pure and pass dependencies explicitly to application operations. Neither app should import the other's source.

## Build, Test, and Development Commands

Use Node.js 24 and pnpm. Install dependencies with `pnpm --dir <directory> install --frozen-lockfile`, first in `shared`, then `apps/core` and `apps/mobile`.

- `docker compose up --build`: start PostgreSQL, migrations, and web at `http://localhost:3000`.
- `pnpm --dir apps/core build`: build the web application.
- `pnpm --dir apps/core dev`: build and start the server with watching.
- `pnpm --dir apps/mobile start`: start Expo development.
- `pnpm --dir apps/core test:unit`: run core unit tests.
- `pnpm --dir apps/mobile test`: run mobile Jest tests.
- From `apps/core`, run `sh scripts/run-tests.sh integration` or `sh scripts/run-tests.sh e2e` to prepare the isolated database and run those suites; Docker and `psql` are required.

Run `pnpm --dir <app-directory> lint` and `pnpm --dir <app-directory> typecheck` for each affected app.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, descriptive kebab-case filenames, and PascalCase React components. Match surrounding formatting; ESLint is configured per app. Follow `docs/programming-style.md`: validate JSON boundaries with shared Zod schemas and represent expected failures with `Result<T, E>`.

## Testing Guidelines

Core uses Vitest, with Playwright for browser interactions; mobile uses Jest and React Native Testing Library. Colocate `.test.ts`/`.test.tsx` files with implementations; core also has `.test.mjs` integration tests. User journeys belong in `tests/e2e/`. Add focused regression checks and meaningful boundary cases; no numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

History uses imperative subjects such as `Add mobile list row component`, alongside `docs:` and `chore:` prefixes. Keep commits focused. In PRs, describe behavior changes, link relevant issues, report validation, and include screenshots for UI changes.

## Security & Database Changes

Never expose server secrets to mobile. Preserve company isolation and enforce authorization server-side. Follow `.agents/skills/database-migrations/SKILL.md` for database changes. Avoid `docker compose down -v` unless intentionally deleting local data.
