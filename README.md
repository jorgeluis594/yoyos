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

The `migrate` service applies migrations and creates the `core_app` role; the web application starts with that restricted role. Open [http://localhost:3000](http://localhost:3000). To stop the services, press `Ctrl+C` or run:

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

## Contributor documentation

- [Product definition](PRODUCT.md).
- [Architecture](docs/architecture.md) and [domain rules](docs/domain.md).
- [Programming style](docs/programming-style.md) and [testing conventions](docs/testing-conventions.md).
- [Persistence](docs/persistence.md) and [company data isolation](docs/rls-with-prisma.md).
- [Image API](docs/images-api.md).

For database changes, use the [database migrations skill](.agents/skills/database-migrations/SKILL.md).
