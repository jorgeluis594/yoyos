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

## Repository structure

| Directory | Contents |
| --- | --- |
| [`apps/core/`](apps/core/) | Web application and server: React, React Router, Express, Prisma, and PostgreSQL. |
| [`apps/mobile/`](apps/mobile/) | Mobile application: React Native and Expo. |
| [`landing/`](landing/) | Public marketing landing: Astro, static output, no UI framework. |
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

The landing is an independent package with its own lockfile (see [`landing/README.md`](landing/README.md)):

```sh
pnpm --dir landing install --frozen-lockfile
pnpm --dir landing build
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

A volume created with a musl-based image such as `postgres:18-alpine` sorts text differently from the glibc-based `pgvector/pgvector` image in use, so its text indexes become silently inconsistent. Reindex such a volume once, right after its first start on `pgvector/pgvector` and before writes resume:

```sh
docker compose stop web worker
docker compose up -d db
docker compose exec db psql -U core -d core -c 'REINDEX DATABASE core'
```

In Coolify, run the same `REINDEX DATABASE core` in the `db` container's terminal right after the first deployment on the new image. `ALTER DATABASE … REFRESH COLLATION VERSION` does not fix this and fails on these volumes.

## Deployment with Coolify

The Git-based Coolify application uses [`compose.prod.yaml`](compose.prod.yaml) from the repository root. It runs PostgreSQL with a persistent volume, applies migrations with the database administrator role, then starts the web server and event worker with the restricted `core_app` role. The database has no public port.

1. In Coolify, create an Application from the public GitHub repository `jorgeluis594/yoyos`. Select Docker Compose, set the base directory to `/`, and set the Compose location to `compose.prod.yaml`.
2. Set `RESEND_API_KEY` and `CATALOG_BASE_URL` in Coolify's environment variables. `CATALOG_BASE_URL` is the base domain of the [public catalog](docs/public-catalog.md#environments)'s brand addresses: `https://yoyos.lat`. There is no staging catalog domain. It has no default: Coolify stores the Compose file's `${CATALOG_BASE_URL:?…}` error text as the variable's value until a real one is set, so check in Environment Variables that the stored value is the URL. Without a valid `https` URL the `migrate` service exits before changing the schema and `web` does not start. The configured sender is `Yoyos <cuentas@yoyos.lat>`, whose domain must be verified in Resend. Coolify generates the `SERVICE_PASSWORD_64_POSTGRES`, `SERVICE_PASSWORD_64_APPDB`, and `SERVICE_PASSWORD_64_AUTH` values referenced by the Compose file.
3. Assign `https://app.yoyos.lat` to the `web` service on internal port `3000`. The DNS A record must point to the Coolify server, and ports 80 and 443 must reach its proxy.
4. Deploy. Wait for `migrate` to exit successfully and for `web` and `worker` to start. Verify account registration and the verification email before testing business flows.

Images require the `R2_*` environment variables from [`apps/core/.env.example`](apps/core/.env.example). WhatsApp connections are optional for initial tests. Keep backups of the PostgreSQL volume before upgrades; the migration service runs again on each deployment.

## Catalog brand hosts

Production serves each published catalog at `https://{subdomain}.yoyos.lat/` ([public catalog](docs/public-catalog.md#brand-host)). The chain is: Cloudflare (proxied wildcard record, Universal SSL for `*.yoyos.lat`, Always Use HTTPS) → Coolify's Traefik (the `yoyos-stores` routers, Traefik's default certificate) → `web`, which picks the store from the host. `app.yoyos.lat` keeps its own Coolify domain and Let's Encrypt certificate.

Cloudflare's SSL mode stays **Full**: the buyer's browser sees Cloudflare's Universal SSL certificate for `*.yoyos.lat`, and Cloudflare encrypts the hop to the origin without validating the certificate Traefik serves for brand hosts (its default self-signed one). Reason: no certificate or key to create, install or renew on the server (decided by the founder on 2026-10-23; rejected for now: Full (strict) with a Cloudflare Origin CA certificate, which also verifies the origin but adds a key to install in Traefik; a Let's Encrypt wildcard through DNS-01, which puts a DNS credential on the app server). Moving to Full (strict) later needs an origin certificate for `*.yoyos.lat` in Traefik first, or every brand host answers 526.

Set up, in order:

1. **Traefik routing.** The `yoyos-stores` and `yoyos-stores-http` routers are labels on the `web` service in [`compose.prod.yaml`](compose.prod.yaml), so they are versioned and survive redeploys. Do not add `*.yoyos.lat` as a Coolify domain: Coolify would attach its Let's Encrypt resolver, which cannot issue a wildcard over HTTP-01. The routers have low priority, so the exact `app.yoyos.lat` rule wins; they have no certificate resolver, so Traefik serves its default certificate, which Full accepts; the HTTP router redirects plain HTTP to HTTPS. In the Compose file the regex anchor is written `$$`, which interpolation turns into `$`; a bare `$` breaks the deploy. Check:
   - Servers → Proxy shows Traefik v3 (for v2 the rule is ``HostRegexp(`{subdomain:[a-z0-9-]+}.yoyos.lat`)``);
   - **Show deployable compose** shows the labels on `web` with a single `$`, and every router Coolify generates for `web` names its own `.service=`, because Traefik refuses an unnamed service when a container defines two;
   - Cloudflare → Workers Routes has no route matching `*yoyos.lat/*` or `*.yoyos.lat/*`, so the landing Worker never captures brand hosts.
2. **Environment.** `CATALOG_BASE_URL=https://yoyos.lat` in production (see the deployment steps above), then redeploy.
3. **DNS.** Cloudflare → DNS → Records: type `A`, name `*`, the production server's IPv4, **Proxied**, TTL Auto. The explicit apex, `www` and `app` records keep precedence over the wildcard.
4. **HTTPS and SSL mode.**
   - SSL/TLS → Edge Certificates → **Always Use HTTPS**: On, so typed `http://` addresses are redirected at the edge.
   - Right after, check that the Let's Encrypt renewal path of `app.yoyos.lat` still reaches the origin over HTTP: `curl -sSI http://app.yoyos.lat/.well-known/acme-challenge/x` must answer 404 with no `location`. A redirect to `https://` would make the app host's certificate fail to renew weeks later (a 526 on the whole app). In that case turn **Always Use HTTPS** off (the origin HTTP router still redirects brand hosts) and keep Full.
   - SSL/TLS → Overview: keep **Full**. Do not switch to Full (strict) without an origin certificate for `*.yoyos.lat` in Traefik.
   - The redirect rules for the apex (`yoyos.lat` → `app.yoyos.lat` for core paths) and for `www` must match exact hostnames (`http.host eq "yoyos.lat"`), not the wildcard.
   - The apex rule does not include `/checkout`: the checkout lives only on brand hosts, so `https://yoyos.lat/checkout/...` is not redirected to `app.yoyos.lat`, which no longer serves it.
   - Rollback: **Always Use HTTPS** off takes effect within seconds and needs no deploy.
5. **Verify.** Until a catalog is published, any free name must answer «Catálogo no disponible».

   ```sh
   dig +short fantasio.yoyos.lat                                                                  # Cloudflare IPs, not the server's
   curl -sSI http://no-existe.yoyos.lat/ | grep -iE '^(HTTP|location)'                            # 301/308 to https://no-existe.yoyos.lat/
   curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://no-existe.yoyos.lat/   # 404 0
   curl -sS https://no-existe.yoyos.lat/ | grep -c 'Catálogo no disponible'                       # 1
   curl -sSI https://<published>.yoyos.lat/ | grep -iE '^(HTTP|referrer-policy)'                 # 200, no-referrer
   curl -sS https://<published>.yoyos.lat/ | grep -c 'noindex'                                   # 1
   curl -sS -o /dev/null -w '%{http_code}\n' https://<published>.yoyos.lat/api/me                # 404 (seller API; only /api/buyer/orders/... and the buyer-mode POST /api/quotations pass, for the checkout)
   curl -sS -o /dev/null -w '%{http_code}\n' https://no-existe.yoyos.lat/checkout/<order id>   # 404, same «Catálogo no disponible» as /
   curl -sSI https://<published>.yoyos.lat/checkout/<order id> | grep -iE '^(HTTP|referrer-policy|cache-control)'   # 200, no-referrer, no-store
   curl -sS -o /dev/null -w '%{http_code}\n' https://<published>.yoyos.lat/api/buyer/orders/<order id>/payment   # 200 or 409 for an order of that store, 404 for another company's order
   curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' -d '{"orderId":"<order id>","destination":{"country":"PE","districtCode":"150122"}}' https://<published>.yoyos.lat/api/quotations   # 201 for an order of that store, 404 for another company's order
   curl -sS -o /dev/null -w '%{http_code}\n' https://app.yoyos.lat/checkout/<order id>             # 404: the app host no longer serves the checkout
   curl -sS https://<published>.yoyos.lat/robots.txt                                             # Disallow: /
   curl -sSI https://app.yoyos.lat/catalogo/<company id> | grep -iE '^(HTTP|location|cache-control)'  # 308 to the brand host, no-store
   curl -sSI https://yoyos.lat/ | head -1                                                         # landing unchanged
   curl -sSI https://yoyos.lat/checkout/<order id> | grep -i '^location'                         # nothing: the apex does not redirect the checkout
   curl -sSI https://www.yoyos.lat/ | grep -i '^location'                                         # still to the apex
   # Origin answers brand hosts over HTTPS (default certificate, so skip verification):
   curl -sSk --resolve fantasio.yoyos.lat:443:<server ip> -o /dev/null -w '%{http_code}\n' https://fantasio.yoyos.lat/   # 404 or 200
   # The app host keeps its publicly trusted certificate at the origin:
   curl -sS --resolve app.yoyos.lat:443:<server ip> -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.yoyos.lat/health   # 200 0
   # Plain HTTP at the origin redirects:
   curl -sSI --resolve fantasio.yoyos.lat:80:<server ip> http://fantasio.yoyos.lat/ | grep -iE '^(HTTP|location)'   # 301/308 to https
   ```

   Inside the `web` container, `curl -H 'Host: fantasio.yoyos.lat' http://127.0.0.1:3000/` confirms that core sees the brand host. Also open a test brand address on a phone (Chrome Android, Safari iOS and the Instagram in-app browser) with no certificate warning.

In local Docker, brand hosts open at `http://{subdomain}.localhost:${WEB_PORT}/` with no DNS.

## Contributor documentation

- [Product definition](PRODUCT.md).
- [Architecture](docs/architecture.md) and [domain rules](docs/domain.md).
- [Programming style](docs/programming-style.md) and [testing conventions](docs/testing-conventions.md).
- [Logging and observability](docs/logging.md).
- [Persistence](docs/persistence.md) and [company data isolation](docs/rls-with-prisma.md).
- [Images](docs/images.md).
- [Event bus](docs/event-bus.md).
- [Landing](docs/landing.md).

Migration output records start/end, duration, each attempted migration identifier and aggregate order/buyer counts. Raw Prisma output is withheld because database errors can contain row values. On failure, inspect `_prisma_migrations` through administrative access, resolve the recorded cause and retry; do not expose its `logs` column to application logging. Keep order writes stopped through migration and deployment of the matching application.

For database changes, use the [database migrations skill](.agents/skills/database-migrations/SKILL.md).
