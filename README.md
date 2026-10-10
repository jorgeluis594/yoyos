# Yoyos

**A sales management system for businesses selling on social media.**

Yoyos is designed for sellers and teams who offer their products through posts, status updates, and live streams, including TikTok lives, and communicate with customers primarily through WhatsApp. Its goal is to connect that selling activity with day-to-day business operations: closing sales, recording orders, and tracking payments and deliveries.

The initial focus is businesses selling through live streams that need to keep their operations organized during and after each broadcast. Each business manages its own sales through a shared web and mobile product experience.

## Product scope

- **Products:** organize the products a business offers through its social channels.
- **Sales and orders:** support closing sales and recording what was agreed with each customer.
- **Payments:** track payment status for orders.
- **Deliveries:** track each order's delivery status.
- **Business operations:** support the daily work of sellers and their teams.

## Current status

The project is under development.

## Repository structure

| Directory | Contents |
| --- | --- |
| [`apps/core/`](apps/core/) | Web application and server: React, React Router, Express, Prisma, and PostgreSQL. |
| [`apps/mobile/`](apps/mobile/) | Mobile application: React Native and Expo. |
| [`shared/`](shared/) | Types and utilities shared across applications. |
| [`docs/`](docs/) | Architecture, domain, persistence, and testing guides. |

## Local development with Docker

From the repository root, start the web application and PostgreSQL:

```sh
docker compose up --build
```

The `migrate` service creates the restricted `core_app` role before applying migrations through `scripts/migrate.ts` (Prisma deploy plus safe aggregate logs), then provisions permissions. Existing application tables receive DML access, and default privileges grant the same access to future `public` tables created by the migration role. Prisma migration history stays private. Functions require explicit grants. The web application starts with the restricted role. Open [http://localhost:3000](http://localhost:3000). To stop the services, press `Ctrl+C` or run:

```sh
docker compose down
```

PostgreSQL preserves data in a volume when services stop. To also delete that data, use `docker compose down -v`.

To manually create the development account and its Peruvian company:

```sh
docker compose exec web pnpm seed
```

Sign in with `demo@yoyos.local` and `demo-password-123`. The command can be run again without changing the existing name, password, or linked company.

## Local installation

With Node.js 24 and pnpm, install shared dependencies first, followed by each application's dependencies:

```sh
pnpm --dir shared install --frozen-lockfile
pnpm --dir apps/core install --frozen-lockfile
pnpm --dir apps/mobile install --frozen-lockfile
```

Money is available from `@shared/money`. `decimal.js` is a private dependency of `shared/`; Docker installs it automatically.

Run the mobile app with `pnpm --dir apps/mobile start`.

To run the Money tests and check shared contracts in both applications:

```sh
cd apps/core
pnpm exec tsx --test ../../shared/money.test.mjs
pnpm typecheck
cd ../mobile
pnpm exec tsc --noEmit
```

## Updating an existing installation

Stop the web application before migrating and preserve the PostgreSQL volume:

```sh
docker compose stop web
docker compose up --build migrate
docker compose up --build -d web
```

Do not use `docker compose down -v` during an update: it deletes the data.

## Staging deployment with Coolify

The Git-based Coolify application uses [`compose.prod.yaml`](compose.prod.yaml) from the repository root. It runs PostgreSQL with a persistent volume, applies migrations with the database administrator role, then starts the web server and event worker with the restricted `core_app` role. The database has no public port.

1. In Coolify, create an Application from the public GitHub repository `jorgeluis594/yoyos`. Select Docker Compose, set the base directory to `/`, and set the Compose location to `compose.prod.yaml`.
2. Set `RESEND_API_KEY` in Coolify's environment variables. The configured sender is `Yoyos <cuentas@kogozstaging.lat>`, whose domain must be verified in Resend. Coolify generates the `SERVICE_PASSWORD_64_POSTGRES`, `SERVICE_PASSWORD_64_APPDB`, and `SERVICE_PASSWORD_64_AUTH` values referenced by the Compose file.
3. Assign `https://yoyos.kogozstaging.lat` to the `web` service on internal port `3000`. The DNS A record must point to the Coolify server, and ports 80 and 443 must reach its proxy.
4. Deploy. Wait for `migrate` to exit successfully and for `web` and `worker` to start. Verify account registration and the verification email before testing business flows.

Images require the `R2_*` environment variables from [`apps/core/.env.example`](apps/core/.env.example). WhatsApp connections are optional for initial staging tests. Keep backups of the PostgreSQL volume before upgrades; the migration service runs again on each deployment.

## Contributor documentation

- [Product definition](PRODUCT.md).
- [Architecture](docs/architecture.md) and [domain rules](docs/domain.md).
- [Programming style](docs/programming-style.md) and [testing conventions](docs/testing-conventions.md).
- [Logging conventions](docs/logging-conventions.md).
- [Persistence](docs/persistence.md) and [company data isolation](docs/rls-with-prisma.md).
- [Image API](docs/images-api.md).
- [Event bus quick start](docs/event-bus-quick-start.md).

Migration output records start/end, duration, each attempted migration identifier and aggregate order/buyer counts. Raw Prisma output is withheld because database errors can contain row values. On failure, inspect `_prisma_migrations` through administrative access, resolve the recorded cause and retry; do not expose its `logs` column to application logging. Keep order writes stopped through migration and deployment of the matching application.

For database changes, use the [database migrations skill](.agents/skills/database-migrations/SKILL.md).
