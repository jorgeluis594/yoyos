# Public catalog by brand subdomain: technical design

**Status:** design closed, pending implementation. The architecture review gate answered the questions (see section 17). Based on [`docs/drafts/catalog-subdomain.md`](catalog-subdomain.md), the product definition approved by the review gate in round 3. Base: `jorgeluis594/refactor-del-catalogo-publico-por-subdom` at `d74395e5`.

## 1. Technical goal

Each company stores one catalog subdomain. Core recognizes a request to `https://{subdomain}.{catalog base domain}/` by its host and resolves, in one query, the company that owns that subdomain and whether its catalog is published. It serves only that company's published catalog there: the grid at `/`, the product page at `/productos/:productId`, and the cart resource route at `/carrito`. Any other path on a brand host renders the store's themed «No encontramos esta página», or «Catálogo no disponible» when there is no published store. The cart route keeps its JSON outcomes. Sellers check and save the subdomain from the **Publicar catálogo** card (web and mobile). Publishing requires a saved subdomain, and the database enforces that rule. Legacy `/catalogo/:companyId` links redirect to the brand address. The checkout stays on the app host. The brand-host cart learns that its order was confirmed by asking core, only when it has already sent that order to **Continuar**.

```text
Buyer browser ── http(s)://fantasio.yoyos.lat/… ──▶ Cloudflare (proxied *.yoyos.lat, Universal SSL, Always Use HTTPS)
                                                       │  Host: fantasio.yoyos.lat
                                                       ▼
                                VPS · Coolify Traefik (yoyos-stores routers, Cloudflare Origin CA certificate)
                                                       ▼
                core Express: req.hostname ─▶ classifyHost ─▶ app | store(label) | invalid
                       │                                          │
        store/invalid host: /api/* → 404, robots.txt and          React Router root middleware
        scanner paths → static answer                              │ resolve_catalog_subdomain(label): 1 query → owner, published, name, country
                                                                   ▼
                              storefront routes (/, /productos/:id, /carrito) with the resolved store in context
                                                                   │ Continuar → checkoutUrl on app host
                                                                   ▼
                                       https://app.yoyos.lat/checkout/:companyId/:orderId (unchanged)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Where the subdomain is stored | A nullable `Company.catalogSubdomain` column with a unique index, next to the existing `Company.catalogPublished`. The subdomain is an attribute of the company's catalog and has no identity of its own, so it gets no table. |
| "Published requires a subdomain" | A `CHECK (NOT "catalogPublished" OR "catalogSubdomain" IS NOT NULL)` on `Company`. Publishing is a conditional update that also requires the subdomain, and the constraint is the backstop. A published catalog without a subdomain cannot be stored. |
| Deploy-time hiding | The same migration sets `catalogPublished = false` on every row before it adds the constraint. Every company starts without a subdomain, so every catalog becomes hidden in the migration's transaction. No company gets a subdomain automatically. |
| Format and reserved names | A `CHECK` on `catalogSubdomain` (`^[a-z0-9]+(-[a-z0-9]+)*$`, 3–30 characters) backs the pure parser. The reserved list lives only in code and is applied only when a company chooses a name (availability and save). It is never applied when a host is resolved. A name added to the list later therefore never takes away a subdomain a company already saved. |
| Cross-company lookup | One `SECURITY DEFINER` function, `resolve_catalog_subdomain(subdomain text)`, follows the existing `resolve_buyer_order_company` pattern. It returns at most one row (`company_id`, `published`, `name`, `country`), so the brand host resolves in one round trip, and the availability check uses the same function. Every other read and write stays under the `Company` RLS policy. |
| Uniqueness race | The unique index on `catalogSubdomain` decides it. `UPDATE "Company" SET "catalogSubdomain" = $1 WHERE id = $company` raises `23505`, which the adapter translates to `SUBDOMAIN_TAKEN`. A failed update assigns nothing and keeps the previous value. The single statement replaces the old value and releases it in the same commit. |
| Base domain per environment | One server variable, `CATALOG_BASE_URL` (scheme, host and optional port, with no path). Production: `https://yoyos.lat`. Staging: `https://yoyos.kogozstaging.lat` (brand hosts do not work there; section 17). Docker dev: `http://localhost:${WEB_PORT}`. E2E: `http://localhost:4173`. The store URL is `{protocol}//{subdomain}.{host}/`. The visible suffix is `.{host}`. Production requires it; other environments fall back to `http://localhost:3000`, the same as `BETTER_AUTH_URL`. Initial value, adjustable. |
| A missing or invalid `CATALOG_BASE_URL` | Coolify stores the `${CATALOG_BASE_URL:?…}` error text as the variable's literal value, so compose interpolation never refuses the deploy.<br>- **Guard in `migrate`.** `compose.prod.yaml` gives the variable to `migrate` too. Its command starts with a shell check, `case "$$CATALOG_BASE_URL" in https://*) ;; *) echo "CATALOG_BASE_URL must be an https URL" >&2; exit 1;; esac &&`. A missing value or the placeholder fails `migrate` before any schema change, and `web` and `worker` never start, because they depend on `service_completed_successfully`.<br>- **`web` check.** `web` still validates the full config (`parseStorefrontConfig`) at import, and crash-loops on any value the shell guard lets through (for example, an `https://` value with a path).<br>- **Not verified:** whether Coolify keeps the previous containers serving after a failed `migrate`. Setting the variable in production and staging, and checking that the stored value is a real URL, therefore stays a precondition of the merge (section 16, Merge preconditions).<br>The worker never imports the storefront config. |
| Simulated hosts in dev and tests | `*.localhost` resolves to loopback in Chromium, Firefox and curl, so `http://fantasio.localhost:3000/` works locally with no DNS. E2E launches Chromium with `--host-resolver-rules=MAP *.localhost 127.0.0.1`, so the result is deterministic. Route and middleware tests build `Request`s with any `Host`. |
| Which host is a store host | `classifyHost(hostname)` judges format only. A hostname of exactly one DNS label plus the base hostname is a store host (`fantasio.yoyos.lat`), unless it equals the app hostname (`new URL(BETTER_AUTH_URL).hostname`). A label that fails the format (too long, edge or double hyphen, invalid characters) or a deeper name (`a.b.yoyos.lat`) is `invalid`. Every other hostname is the app host (`app.yoyos.lat`, `127.0.0.1`, `localhost`, the base apex). A reserved label with no owner resolves to «Catálogo no disponible» through the owner lookup. Infrastructure names (`www`, `app`) never reach core as store hosts, because their explicit DNS records and the app-host check decide them first. The port is ignored. |
| Host source | Express `req.hostname` (Express 5, `trust proxy` = `loopback, uniquelocal`, so it honours Traefik's `X-Forwarded-Host`). It reaches React Router through `createRequestContext(req.ip, req.hostname)` in a new `requestHostContext`. Outside Express (route tests), the middleware falls back to `new URL(request.url).hostname`. |
| Routing on the brand host | React Router keeps one route config. A root middleware, `storefrontMiddleware`, resolves the store for store and invalid hosts and sets `storefrontContext`. For the document paths `/` and `/productos/:productId`, an unavailable store throws `data({ kind: "catalog_unavailable" }, 404)`. For `/carrito`, the middleware never throws: it passes `{ kind: "unavailable" }` on, and the route answers today's JSON outcomes. Any other path throws a 404: `store_not_found` with the header on a published store, `catalog_unavailable` otherwise. A new root `ErrorBoundary` renders the themed «No encontramos esta página» or «Catálogo no disponible» from the thrown data. The storefront routes sit under a pathless layout, `catalog-layout.tsx`, whose middleware handles the app host: `/` keeps today's 308 to `/es-PE/`, and the other storefront paths answer the generic 404. |
| Resolved store reused | `storefrontContext` carries the `CatalogStore` (name, currency) resolved by the middleware. The storefront compositions supply it as the use cases' `readStore`, so a request reads it once. A catalog hidden between the middleware and the loader of the same request is the product's accepted "open page on a changed address" window. |
| Brand host edge answers | Before React Router, Express answers on store and invalid hosts:<br>- `/api/*`: `404 {"code":"NOT_FOUND"}`, before Better Auth and the routers;<br>- `/robots.txt`: `User-agent: *` / `Disallow: /`, static, `Cache-Control: public, max-age=86400`;<br>- common scanner paths (`*.php`, `/.env`, `/.git/*`, `/wp-*`, `/xmlrpc.php`): a plain `404`, with no database query and no render.<br>A brand host never signs anyone in and never serves seller data. |
| Session cookies | Better Auth cookies stay host-only on the app host. No cookie `Domain` and no `crossSubDomainCookies`, so brand hosts never receive a seller session. |
| Legacy links | `/catalogo/:companyId` and `/catalogo/:companyId/productos/:productId` become redirect-only routes:<br>- published with a subdomain: 308 to the brand URL, with the query kept and `Cache-Control: no-store`. The status stays permanent (decision 13), and browsers do not keep the target indefinitely, which reduces the deferred stale-subdomain risk;<br>- otherwise: «Catálogo no disponible» (404).<br>The redirect does not check the product. A product of another company redirects anyway, and the brand host then answers «Este producto ya no está disponible».<br>`/catalogo/:companyId/carrito` keeps answering the catalog-turned-off outcome (`GET` 404, `POST` 409 `CATALOG_UNAVAILABLE`). |
| Continuar target | The cart sheet navigates to the full `checkoutUrl` (app host). Today it keeps only the pathname. `checkoutUrl` keeps being built from `BETTER_AUTH_URL`. |
| Cart after confirming | The storefront asks core `POST /carrito` `{ intent: "check_order", orderId }`, which answers `{ order: "confirmed" \| "not_confirmed" }`. The browser empties the cart on `confirmed`. It asks only when the stored cart has lines and its current `orderId` was already sent to **Continuar** (a `continued` flag stored with the cart, dropped whenever `withLines` rotates the id). It asks at most once per document load, and again on `pageshow` with `persisted` (the back button from the checkout restoring a bfcache page). The checkout's `clearCartForOrder` effect is removed, because the catalog no longer shares its origin. |
| Confirmation read | One statement on the unique `(companyId, id)` index: `SELECT "checkoutConfirmedAt" IS NOT NULL FROM "Order" WHERE "companyId" = $1 AND id = $2 AND "fromCatalog"`. No aggregate, no company read, no request-log binding. The order number and order id never reach brand-host logs. |
| Rate limits | **Continuar** keeps `allowCatalogOrder` (20 per IP per 10 minutes). `check_order` is outside it and has its own per-IP limiter (`CATALOG_ORDER_CHECK_RATE_LIMIT`, 120 per 10 minutes, initial value, adjustable). Reason: it is a cheap unauthenticated read that must never spend the budget of the write that creates sales, but it stays bounded on a public host. A limited `check_order` answers 429, and the cart stays as it is. The availability check has a per-user limiter (`CATALOG_SUBDOMAIN_CHECK_RATE_LIMIT`, 60 per minute, initial value, adjustable), keyed by `userId`, because it is authenticated. Its 429 shows the existing «No pudimos revisar si está disponible.» state. All limiters use the existing in-memory `createRateLimiter`. T1 gives it an optional `onFirstRejection` callback, and existing callers are unchanged. The two new limiters log their warn only for the first rejection per key per window, so a scripted client cannot turn each of its own 429s into a log line. Keying behind Cloudflare is a deferred item (below). |
| Cart key | `yoyos.catalog-cart.${companyId}` stays. The storefront loader returns the resolved `companyId`, so a released subdomain taken by another company reads another key and shows an empty cart. |
| Availability answer | `available`, `current`, `in_use`, `reserved` or `invalid` (with the reason). It is answered only to an authenticated seller with a company. It never says which company holds a name. Clients call it only for a value the shared rules accept that is not reserved and differs from the saved subdomain. They decide `invalid`, `reserved` and `current` locally. |
| Suggestion | Computed by core in the settings read (`suggestion`), only when the company has no subdomain and the derived value is valid, not reserved and free at that moment. Clients never derive it. |
| Format rules shared by web and mobile | `shared/catalog-subdomain.ts`: `parseCatalogSubdomain`, `reservedCatalogSubdomains`, `suggestCatalogSubdomain`. Core's domain, the web card and the mobile card use them, so the instant state never disagrees with the server. Core still validates every save. |
| Web transport for the link | The web card's link group calls the same JSON API as mobile with plain `fetch`, same-origin, using the seller's session cookie (`loadApiAccess` resolves it, and `payment-settings.tsx` already calls `/api/images` this way):<br>- the check: `GET /api/catalog/subdomain-availability`;<br>- the save: `PUT /api/catalog/subdomain`;<br>- the in-doubt re-read: `GET /api/catalog/settings`.<br>A small client, `app/lib/catalog-link-client.ts`, validates every answer with the shared schemas and returns `{ kind: "answered"; … } \| { kind: "not_sent" } \| { kind: "no_response" }`:<br>- `not_sent`: `navigator.onLine === false` before sending, as `catalog-cart.tsx` and `use-instant-delivery-settings.ts` already do;<br>- `no_response`: `fetch` rejects, `AbortSignal.timeout` fires (15 s, initial value, adjustable), the answer is a `5xx`, or its body fails the schema;<br>- `answered`: any validated answer, including 409, 422 and 429.<br>A `503` on a save is treated as `no_response`: the commit may have happened, and the save is idempotent, so the card re-reads. None of the three goes through a route loader, action, fetcher or revalidation, so a network failure never reaches the editor's `ErrorBoundary`, never replaces the card, and never clears the logo and theme draft or the typed link. The card keeps the returned `CatalogSettings` as its state; the editor loaders are not revalidated after a link save. The reason for leaving the loader and action pattern here: the editor already loads its preview cards with a plain `fetch` for the same reason (`store-appearance-settings.tsx` `clientAction` comment). The publication switch keeps its `set-publication` action and its existing `clientAction`/`shouldRevalidate` handling, unchanged. Mobile uses the same API. |
| Old mobile builds | The settings response changes shape (`url` becomes nullable, new fields), so builds older than this version fail to read it. The product accepts this (decision 19). No compatibility field is kept. |
| Documentation promotion | Not an implementation task. The coordinator promotes the drafts into `docs/public-catalog.md` and `docs/checkout.md` after the final verification. |
| Out of this design | Custom domains, subdomain history or redirects, a cooling period for released names, moving the cart between hosts, moving the checkout, and measuring visits. All are listed in the product draft. |
| Deferred, with real risk | Two items. No Todoist task exists for either; the founder decides whether to create them.<br>1. **Subdomain reuse.** Reuse of a released subdomain by another company, and legacy 308s cached before this design's `no-store` (none exist in production). Flagged by the product draft.<br>2. **Per-IP limits behind Cloudflare.** Express `trust proxy` is `loopback, uniquelocal`, so behind Cloudflare and Traefik `req.ip` is most likely a Cloudflare edge address. `allowCatalogOrder` (**Continuar**, existing) and `allowCatalogOrderCheck` are then shared by every buyer behind the same edge address. A shared **Continuar** budget can refuse unrelated buyers' orders. This predates the design, which does not worsen it.<br>Not fixed here, because the fix changes how the whole app trusts proxies (sign-in, logs, every limiter) and needs a maintained list of Cloudflare ranges: either Traefik `forwardedHeaders.trustedIPs`, or Express `trust proxy` extended with Cloudflare's ranges. `CF-Connecting-IP` must never be trusted blindly, because the origin is reachable directly. Recommended before catalog traffic is real. |
| Deferred, improvement | `refreshCart` resolves cart images one by one (`cart-composition.ts:21-25`, an N+1 of up to 30 sequential lookups on `/carrito` `GET`). It predates this design. A follow-up batches them into one query. Out of scope for T4. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Publication flag | `Company.catalogPublished` (`apps/core/prisma/schema.prisma:89`, migration `20261017050645_add_public_catalog`) | Reused. Gains the `CHECK` with the subdomain. |
| Settings use cases | `apps/core/src/features/catalog/application/catalog-settings.ts` (`getCatalogSettings`, `setCatalogPublication`) | Modified: subdomain, suggestion, and the publish rule. |
| Settings repository | `apps/core/src/features/catalog/infrastructure/catalog-settings-repository.ts` (`readPublished`, `savePublished`) | Replaced by `readCatalogSettings` and `savePublication`, plus `saveSubdomain` and `resolveSubdomain`. |
| Settings composition | `apps/core/src/features/catalog/composition.ts` (`catalogSettings.get`, `.setPublication`, logs `catalog_publication_changed`) | Extended with `.checkSubdomain` and `.saveSubdomain`. |
| Settings response | `apps/core/src/features/catalog/presentation/settings-response.ts` (`catalogUrl` = `BETTER_AUTH_URL` + `/catalogo/:id`) | Rewritten around `storeUrl(subdomain)`. |
| Settings API | `apps/core/src/features/catalog/presentation/api-routes.ts` (`GET`/`PUT /api/catalog/settings`), mounted at `apps/core/src/app.ts:101` | Extended with availability and subdomain routes. |
| Rate limiter | `apps/core/src/features/catalog/presentation/rate-limit.ts` (`createRateLimiter(limit, windowMs, now)`, `allowCatalogOrder` from `CATALOG_ORDER_RATE_LIMIT`) | Reused for the two new limiters. |
| Contract | `shared/contracts/catalog.ts` (`catalogSettingsSchema {published, url}`, `setCatalogPublicationSchema`) | Changed (section 8). |
| Store read | `apps/core/src/features/catalog/infrastructure/catalog-store-repository.ts:12` `readStore` (null when unpublished or unknown) | No longer called on storefront requests; replaced there by the resolved store. Still used by the editor preview and the legacy resolver. |
| Browse and cart compositions | `apps/core/src/features/catalog/browse-composition.ts` (`catalogBrowse`), `cart-composition.ts` (`catalogCart`); access `{ companyId }` from the URL | Reused. Access and store now come from the host. `catalogCart.checkOrder` is added. |
| Catalog order creation | `apps/core/src/features/orders/application/create-catalog-order.ts` (same id returns the existing catalog order) | Unchanged. |
| Checkout order read | `findCheckoutOrder` → `findOrderAggregate` (`include: buyer, items, payments`), company name read, `bindRequestOperation({ orderNumber })` (`order-repository.ts:21,225`, `checkout-repository.ts:26`) | Not reused for the confirmation check (section 5.7). |
| Checkout confirmation | `orders.confirmCheckoutDelivery`, `apps/core/app/routes/checkout.tsx:122`; cart clearing effect at `checkout.tsx:198` | Effect removed. The checkout itself is unchanged. |
| Buyer order resolver | Migration `20261005064406_resolve_buyer_order_access` (`resolve_buyer_order_company`, `SECURITY DEFINER`) | Pattern reused for `resolve_catalog_subdomain`. |
| Web routes | `apps/core/app/routes.ts:4,13-15` (`index` → `legacy-redirect.ts`; `catalogo/:companyId`, `…/productos/:productId`, `…/carrito`; `*` → `not-found.tsx`) | Restructured (section 12). |
| Catalog pages | `apps/core/app/routes/catalog.tsx`, `catalog-product.tsx`, `catalog-cart.tsx`, with tests `catalog.test.ts`, `catalog-page.test.tsx`, `catalog-cart.test.ts`; `apps/core/app/components/catalog-sections.tsx` (+ test), `catalog-cart.tsx` (+ `catalog-cart.test.tsx`), `apps/core/app/lib/catalog-cart-storage.ts` (+ test) | Moved to the storefront paths. Links lose the `/catalogo/:id` prefix. |
| Root | `apps/core/app/root.tsx` (`middleware = [i18nextMiddleware]`, no `ErrorBoundary`) | Gains `storefrontMiddleware` and an `ErrorBoundary`. |
| Request context | `apps/core/app/entry.server.tsx:19` `createRequestContext(clientIp)`, `apps/core/src/server.ts:14-16` | Extended with the hostname. |
| Express app | `apps/core/src/app.ts` (`trust proxy` `loopback, uniquelocal`; no Host handling, no CORS, no cookie domain) | Gains the brand-host edge middleware. |
| Seller web card | `apps/core/app/components/catalog-publication-card.tsx:20` (+ test), route `apps/core/app/routes/store-appearance-settings.tsx` (`readPublication` :47, `set-publication` :78, `shouldRevalidate` :115), `store-appearance-editor-actions.ts`, `app/routes/store-appearance-editor.test.tsx` | Extended with the link group. |
| Seller web Settings → Catálogo | `apps/core/app/routes/catalog-settings.tsx` (+ `catalog-settings.test.tsx`; uses `settings.url`) | Shows the brand link as wrapping text. |
| Mobile catalog feature | `apps/mobile/src/features/catalog/` (`infrastructure/catalog-settings-api.ts`, `presentation/catalog-publication-card.tsx`, `catalog-settings-screen.tsx`, `translations.ts`, `composition.ts`); screen `apps/mobile/src/features/store-appearance/presentation/store-appearance-screen.tsx` (publication slot :45) | Extended. |
| Env | `BETTER_AUTH_URL` read directly from `process.env` (no Zod env module); `compose.yaml:61`, `compose.prod.yaml:41`, `apps/core/.env.example`, `apps/core/scripts/run-tests.sh:51` (e2e app URL `http://127.0.0.1:4173`) | `CATALOG_BASE_URL` added next to it. |
| Coolify variables | Coolify stores a `${VAR:?message}` error text as the variable's placeholder value until a real one is set (repository memory). Production and staging deploy from the same `compose.prod.yaml`. | The basis of the merge precondition. |
| E2E | `apps/core/tests/e2e/public-catalog.spec.ts`, `public-catalog-theme.spec.ts`, `store-appearance-buyer.spec.ts`; `fixtures.ts:6` (baseURL `127.0.0.1:4173`) | Moved to the brand host. |
| Cloudflare | Apex = landing Worker; proxied `A www` and `A app` → 94.72.118.64; 308 rule apex → `app.yoyos.lat` for core paths; SSL/TLS Automatic (running as Full); Universal SSL covers `*.yoyos.lat` (verified by the coordinator on 2026-10-22); no `*` record (NXDOMAIN) | Wildcard record, Origin CA certificate, Always Use HTTPS and Full (strict) added by the founder (section 16, Infra). |
| Coolify | `compose.prod.yaml` `web` (`expose 3000`); Traefik routes by the domains configured in Coolify; `app.yoyos.lat` has a Let's Encrypt certificate | Explicit `yoyos-stores` routers added by the founder. |
| Assumption | The React Router Express adapter builds `request.url` from `Host`/`X-Forwarded-Host`; the design does not depend on it, because the host comes from `req.hostname`. | Verified during implementation (section 15). |

## 4. Gaps this design closes

1. No place to store a subdomain or to enforce its uniqueness and format (section 7).
2. Publishing does not require a subdomain, and catalogs published today have none (sections 5.4 and 7).
3. No availability check, no save, no suggestion (sections 5.1–5.3 and 8).
4. Core does not know which environment domain builds the brand URL (section 6.3).
5. Core does not look at the request host. The catalog resolves its company only from the path (sections 5.5 and 12).
6. The brand host would serve every app route, including the seller panel, sign-in and the API (sections 5.5 and 12).
7. Legacy `/catalogo/:id` links serve the catalog instead of redirecting (section 5.6).
8. **Continuar** drops the host of `checkoutUrl`. The checkout empties the cart only on a shared origin (section 5.7).
9. Seller screens on web and mobile show `/catalogo/:id` and have no link field (sections 10 and 12).
10. The infrastructure does not route `*.yoyos.lat`, over HTTP or HTTPS, to core (section 16, Infra).

## 5. Use cases

All of them belong to `apps/core/src/features/catalog` unless stated. `CompanyId` and `UserId` are the existing brands. Each dependency returns `Result`. Valid absence is `ok(null)`.

Shared dependency, used by 5.1, 5.2 and 5.5:

```ts
type SubdomainOwner = Readonly<{ companyId: CompanyId; published: boolean; store: CatalogStore }>;
resolveSubdomain: (subdomain: CatalogSubdomain) => Promise<Result<SubdomainOwner | null, CatalogSettingsError>>;
```

It is one `systemPrisma.$queryRaw` call to `resolve_catalog_subdomain`, and it builds `CatalogStore` (name, currency from country) as `readStore` does today.

### 5.1 `getCatalogSettings` (modified)

- **input:** none. **access:** `CatalogSettingsAccess { companyId, userId }`.
- **deps:**
  - `readCatalogSettings(companyId): Promise<Result<{ published: boolean; subdomain: CatalogSubdomain | null; companyName: string }, CatalogSettingsError>>`
  - `resolveSubdomain`
- **output:** `CatalogSettings = { published: boolean; subdomain: CatalogSubdomain | null; suggestion: CatalogSubdomain | null }`.
- **errors:** `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA` (stored subdomain fails the parser).
- **flow:**
  1. Read the settings.
  2. If there is a subdomain, return it with `suggestion: null`.
  3. Otherwise derive `suggestCatalogSubdomain(companyName)`. If it returns a value that is not reserved, look up its owner.
  4. The suggestion is the value when there is no owner, and `null` when the value is taken, reserved, too short, or the lookup failed. A failed lookup never fails the read; the adapter logs it once and the suggestion is dropped.

### 5.2 `checkSubdomainAvailability` (new)

- **input:** `{ value: string }` (raw text, at most 200 characters at the boundary). **access:** `CatalogSettingsAccess`.
- **deps:** `resolveSubdomain`. Rate limiting is presentation's job (section 2).
- **output:** `SubdomainAvailability`:
  - `{ status: "available"; subdomain }`
  - `{ status: "current"; subdomain }`
  - `{ status: "in_use"; subdomain }`
  - `{ status: "reserved" }`
  - `{ status: "invalid"; reason: SubdomainFormatReason }`
- **errors:** `PERSISTENCE_UNAVAILABLE`.
- **flow:**
  1. Lowercase the value and run `parseCatalogSubdomain`. An invalid value returns `invalid`, with no query.
  2. Look up the owner (one round trip).
  3. Owner is this company: `current`. This comes before the reserved check, so a name added to the list later never takes away a saved subdomain.
  4. Reserved: `reserved`.
  5. Owner is another company: `in_use`.
  6. Otherwise: `available`.
- Read-only; it writes nothing. Clients call it only for values that pass step 1, are not reserved, and differ from the saved subdomain. The server still answers every case for any client.

### 5.3 `saveCatalogSubdomain` (new)

- **input:** `{ subdomain: string }`. **access:** `CatalogSettingsAccess`.
- **deps:**
  - `readCatalogSettings`
  - `saveSubdomain(companyId, subdomain): Promise<Result<null, SaveSubdomainError>>`. It fails with `SUBDOMAIN_TAKEN` on the unique violation.
- **output:** `CatalogSettings` (after the save) plus `change: "unchanged" | "first" | "replaced"`.
- **errors:** `INVALID_SUBDOMAIN` (with `reason`), `SUBDOMAIN_RESERVED`, `SUBDOMAIN_TAKEN`, `PERSISTENCE_UNAVAILABLE`. On the wire, the reason becomes the envelope's `issues` entry (section 8).
- **flow:**
  1. Parse the subdomain. Values under 3 characters fail with `too_short`. The server never lowercases for the client.
  2. Read the current settings. If the value equals the current subdomain, return `unchanged`, with no write. This makes a retry after a lost response safe, and it lets a company keep a subdomain that became reserved.
  3. A reserved value fails with `SUBDOMAIN_RESERVED`.
  4. `saveSubdomain` runs one scoped `UPDATE … WHERE id = companyId`. The unique index decides a race. A taken value fails with `SUBDOMAIN_TAKEN` and leaves the stored value as it was.
  5. Return the settings built from the step-2 read plus the written value: `published` as read, `subdomain` the new value, and `suggestion: null`. No second read and no suggestion lookup. `change` is `"first"` when there was no previous subdomain, otherwise `"replaced"`.
- The confirmation before replacing a subdomain is a client rule. The server does not ask for a flag, because the product requires the save to work the same whatever the client.

### 5.4 `setCatalogPublication` (modified)

- **input:** `{ published: boolean }`. **access:** `CatalogSettingsAccess`.
- **deps:**
  - `savePublication(companyId, published): Promise<Result<"saved" | "subdomain_missing", CatalogSettingsError>>`. To publish, it runs `UPDATE "Company" SET "catalogPublished" = true WHERE id = $1 AND "catalogSubdomain" IS NOT NULL` and returns `subdomain_missing` when no row matches. To hide, it updates without the condition.
  - `readCatalogSettings` (to return the settings; a published company has a subdomain, so no suggestion lookup runs).
- **output:** `CatalogSettings`.
- **errors:** `SUBDOMAIN_REQUIRED`, `PERSISTENCE_UNAVAILABLE`.
- Hiding is always allowed. Repeating the same value is idempotent, as today.

### 5.5 `resolveStorefront` (new)

- **input:** `{ host: StoreHost }`, the output of `classifyHost`. **access:** none (public, by host).
- **deps:** `resolveSubdomain`.
- **output:** `Storefront`:
  - `{ kind: "published"; companyId; subdomain; store: CatalogStore }`
  - `{ kind: "unavailable" }`
- **errors:** `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA`.
- **flow:**
  1. A host of kind `invalid` returns `unavailable`, with no query.
  2. A host of kind `store` resolves its label in one round trip.
  3. No owner, or an unpublished catalog, returns `unavailable`.
  4. Otherwise it returns `published`.
- One answer (`unavailable`) covers an unknown name, a released name, a reserved name nobody owns, a malformed host and a hidden catalog, so the response never reveals whether a company exists.

### 5.6 `resolveLegacyCatalogLink` (new)

- **input:** `{ companyId: string }`, validated as a UUID at the boundary. **access:** none.
- **deps:** `readCatalogSettings`, run under `withTenantIsolation(companyId)`. Under RLS, an unknown company reads as absent.
- **output:** `{ kind: "redirect"; subdomain } | { kind: "unavailable" }`.
- **flow:** published with a subdomain gives `redirect`; anything else gives `unavailable`. Presentation builds the URL with the product path and the query, and sends 308 with `Cache-Control: no-store`. The product id is not checked.

### 5.7 `checkCartOrder` (new)

- **input:** `{ orderId: OrderId }`. **access:** `CatalogAccess { companyId }`, from a published storefront.
- **deps:** `readCatalogOrderConfirmation(companyId, orderId): Promise<Result<"confirmed" | "not_confirmed", { code: "PERSISTENCE_UNAVAILABLE"; message: string }>>`, a new capability of `orders/composition.ts`. Its single statement is in section 2 ("Confirmation read"). It runs under `withTenantIsolation(companyId)`. A missing, pending or non-catalog order, or one of another company (invisible under RLS), is `not_confirmed`.
- **output:** `"confirmed" | "not_confirmed"`.
- **errors:** `PERSISTENCE_UNAVAILABLE`.
- **On an unavailable store** (hidden, released or unknown host), the route answers `409 { code: "CATALOG_UNAVAILABLE" }` without calling the use case, and the browser keeps the cart. The storefront shows «Catálogo no disponible» there anyway. A cart on a released host taken by another company lives under the previous company's key and is never read.

### 5.8 Existing ones that change only their access source

`browseCatalog`, `getCatalogProduct`, `catalogCart.refresh` and `continueToCheckout` keep their signatures. Their `access.companyId` comes from `storefrontContext` instead of the URL parameter. Their `readStore` (or `readPublished`) dependency is supplied from the resolved store, so the request reads the database once for it. On an unavailable store:

| Route | Outcome |
| --- | --- |
| `/carrito` `GET` (refresh) | `404 { code: "CATALOG_UNAVAILABLE" }`, as today. |
| `/carrito` `POST continue` | `409 { code: "CATALOG_UNAVAILABLE" }`, as today. |
| `/carrito` `POST check_order` | `409 { code: "CATALOG_UNAVAILABLE" }`, as in 5.7. |
| `/` and `/productos/:productId` | Thrown 404 «Catálogo no disponible». |

## 6. Domain and typing

### 6.1 Shared rules (`shared/catalog-subdomain.ts`)

Both apps consume the same rules, and they are pure, so they live in `shared/` like `shared/store-themes.ts`.

```ts
export type CatalogSubdomain = string & { readonly __brand: "CatalogSubdomain" };
/** In priority order; the first that applies is the only reason shown. */
export type SubdomainFormatReason =
  | "contains_domain"      // "." or "://" (covers ".yoyos.lat")
  | "contains_space"
  | "invalid_character"    // anything outside a-z, 0-9, "-"
  | "too_long"             // > 30
  | "hyphen_edge"          // starts or ends with "-"
  | "double_hyphen"
  | "too_short";           // < 3; the UI shows the help text, the server rejects
export const catalogSubdomainLength = { min: 3, max: 30 } as const;
export const reservedCatalogSubdomains: ReadonlySet<string>; // the product list; code may only add
export function parseCatalogSubdomain(value: string): Result<CatalogSubdomain, Readonly<{ reason: SubdomainFormatReason; message: string }>>;
export function isReservedCatalogSubdomain(subdomain: CatalogSubdomain): boolean;
/** «Café Fantasío» → "cafe-fantasio"; null when the result is shorter than 3. Reserved and availability are checked by the caller. */
export function suggestCatalogSubdomain(companyName: string): CatalogSubdomain | null;
```

`parseCatalogSubdomain` receives the value already lowercased:
- the input lowercases as the seller types;
- core lowercases in `checkSubdomainAvailability`;
- the save rejects uppercase as `invalid_character`.

A leading hyphen reports `hyphen_edge` even with one or two characters, because `hyphen_edge` comes before `too_short`.

### 6.2 Host classification (`apps/core/src/features/catalog/domain/store-host.ts`)

```ts
export type StoreHost =
  | Readonly<{ kind: "app" }>
  | Readonly<{ kind: "store"; subdomain: CatalogSubdomain }>  // format-valid label; reserved or not
  | Readonly<{ kind: "invalid" }>;                            // one label that fails the format, or a deeper name
export type HostConfig = Readonly<{ baseHostname: string; appHostname: string }>;
export function classifyHost(hostname: string, config: HostConfig): StoreHost;
```

It lowercases the hostname, strips a trailing dot, and ignores the port. It never consults the reserved list. `app` covers the app hostname and everything not under the base (IPs, `localhost`, the base apex). A label of 1–2 characters is `invalid` (the format requires 3).

### 6.3 Storefront config (`apps/core/src/features/catalog/infrastructure/storefront-config.ts`)

```ts
export type StorefrontConfig = Readonly<{ baseUrl: URL; host: HostConfig }>;
export function parseStorefrontConfig(env: Readonly<{ CATALOG_BASE_URL?: string; BETTER_AUTH_URL?: string; NODE_ENV?: string }>): Result<StorefrontConfig, { code: "INVALID_CONFIG"; message: string }>;
export const storefrontConfig: StorefrontConfig; // parsed once at import; throws at startup on INVALID_CONFIG
export function storeUrl(subdomain: CatalogSubdomain, path?: string): URL; // `${protocol}//${subdomain}.${host}${path ?? "/"}`
export function storeDomain(): string; // baseUrl.host, e.g. "yoyos.lat" or "localhost:3000"
```

The Zod schema requires `http:` or `https:`, a hostname that is not an IP, and no path, query or hash. `https:` is required when `NODE_ENV=production`. The variable is required in production. The Coolify placeholder text (`CATALOG_BASE_URL is required`) is not a URL, so it fails the same way, with an `INVALID_CONFIG` message that names the variable.

### 6.4 Authority per layer

| Layer | Types and authority |
| --- | --- |
| `shared/catalog-subdomain.ts` | Format, reasons, reserved list, suggestion. Pure. |
| Core catalog domain | `StoreHost`, `classifyHost` (format only). |
| Core catalog application | Availability, save, publication rule, storefront resolution, legacy link, cart order check. |
| Core infrastructure | Unique index, `CHECK`s, the `SECURITY DEFINER` lookup, error translation. |
| Core presentation | Rate limits, edge answers on brand hosts, HTTP statuses. |
| Web and mobile | Instant format and reserved state, debounce, latest-answer-only, change confirmation, unsaved-link tracking, `continued` flag of the cart. Never authoritative. |

New types and why they exist:
- `CatalogSubdomain`: a value with rules.
- `SubdomainAvailability`: five distinct outcomes the UI renders.
- `StoreHost`: a three-way classification instead of nullable pairs.
- `SubdomainOwner`: one lookup result shared by availability and storefront resolution.
- `Storefront`: the resolved store, which carries the company for access and the store for reuse.
- `StorefrontConfig`: per-environment values.

`CatalogSettings` gains fields. `CatalogSettingsAccess`, `CatalogAccess` and `CatalogStore` are reused. The cart storage schema gains `continued: boolean`, optional so stored carts keep parsing and default to `false`.

## 7. Persistence

Migration name: `add_catalog_subdomain`, generated with `prisma migrate dev --create-only` and edited following the database-migrations skill. It contains only these statements.

```prisma
model Company {
  catalogPublished Boolean @default(false)
  catalogSubdomain String? @unique
  // …
}
```

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Company" ADD COLUMN "catalogSubdomain" TEXT;
-- Deploy-time rule: no catalog stays published without a subdomain.
UPDATE "Company" SET "catalogPublished" = false WHERE "catalogPublished";
ALTER TABLE "Company" ADD CONSTRAINT "Company_catalogSubdomain_format_check"
  CHECK ("catalogSubdomain" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("catalogSubdomain") BETWEEN 3 AND 30);
ALTER TABLE "Company" ADD CONSTRAINT "Company_catalogPublished_requires_subdomain_check"
  CHECK (NOT "catalogPublished" OR "catalogSubdomain" IS NOT NULL);
CREATE UNIQUE INDEX "Company_catalogSubdomain_key" ON "Company"("catalogSubdomain");

CREATE FUNCTION public.resolve_catalog_subdomain(subdomain text)
RETURNS TABLE (company_id uuid, published boolean, name text, country text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT id, "catalogPublished", name, country FROM public."Company" WHERE "catalogSubdomain" = subdomain
$$;
REVOKE ALL ON FUNCTION public.resolve_catalog_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_catalog_subdomain(text) TO core_app;
COMMIT;
```

- **Locking:**
  - `ADD COLUMN` takes `ACCESS EXCLUSIVE` on `Company` for the transaction. While it is open, it blocks the foreign-key `KEY SHARE` checks of every insert into child tables (orders, chats, messages, products) and the `nextOrderNumber` increment.
  - The table has one row per business. The column is nullable with no default, so there is no rewrite. The `CHECK`s and the non-concurrent unique index scan a tiny table. The transaction therefore lasts milliseconds.
  - `lock_timeout` makes the deploy fail rather than queue every write behind a long-running transaction that holds `Company`.
  - A file with `CREATE FUNCTION` runs as one transaction, so `CONCURRENTLY` is not available, and it is not needed.
- **Deploy window:**
  - The old `web` container keeps serving while `migrate` runs.
  - After the commit, an old-code publish hits the new `CHECK` (`23514`) and shows «No pudimos guardar el cambio». Old-code catalog reads keep working on the old routes until the new `web` starts. Acceptable: there are no customers.
- **Function privileges:** `resolve_catalog_subdomain`, like `resolve_buyer_order_company`, relies on the migration role bypassing `FORCE ROW LEVEL SECURITY` on `Company`. The `Company` RLS policy is unchanged. Reads and writes of the company's own settings use `prisma` under `withTenantIsolation(companyId)`.
- **Lookup:** `resolveSubdomain` calls the function through `systemPrisma.$queryRaw` with a parameter. It validates the row with a Zod row schema (`company_id` UUID, `published` boolean, `name` string, `country` the existing country schema).
- **Error translation:**
  - Prisma `P2002` (or `23505`) on `catalogSubdomain` becomes `SUBDOMAIN_TAKEN`.
  - `23514` on `Company_catalogPublished_requires_subdomain_check` becomes `SUBDOMAIN_REQUIRED`. This is the backstop; the conditional update makes it unexpected.
  - Other failures become `PERSISTENCE_UNAVAILABLE`.
- **Stored rows** are read with a Zod row schema (`catalogSubdomain` through `parseCatalogSubdomain`). A stored value that fails it is `INVALID_STORED_DATA`.
- **Development data:** nothing is deleted. Published catalogs become hidden, as the product requires (there are no customers, guide 6.9).
- **Fixtures:** those that set `catalogPublished: true` also set `catalogSubdomain` (T1).
- **No migration test:** `apps/core/src/features/orders/infrastructure/public-catalog-migration.integration.test.ts` checks the old migration and stays as is. No new migration test is written (Testing skill).

## 8. Contracts between applications

`shared/contracts/catalog.ts`. The JSON API is used by mobile. Web uses the same schemas in its loaders, actions and resource route.

```ts
export const subdomainFormatReasonSchema = z.enum(["contains_domain", "contains_space", "invalid_character", "too_long", "hyphen_edge", "double_hyphen", "too_short"]);

export const catalogSettingsSchema = z.strictObject({
  published: z.boolean(),
  subdomain: z.string().nullable(),
  /** Brand URL of the saved subdomain, e.g. https://fantasio.yoyos.lat/; null without a subdomain. */
  url: z.url().nullable(),
  /** Host the subdomain goes under in this environment, e.g. "yoyos.lat"; the UI shows "." + domain. */
  domain: z.string().min(1),
  /** Available suggestion from the company name; only when subdomain is null. */
  suggestion: z.string().nullable(),
});

export const setCatalogPublicationSchema = z.strictObject({ published: z.boolean() }); // unchanged

export const subdomainAvailabilityQuerySchema = z.strictObject({ value: z.string().max(200) });
export const subdomainAvailabilitySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), subdomain: z.string() }),
  z.strictObject({ status: z.literal("current"), subdomain: z.string() }),
  z.strictObject({ status: z.literal("in_use"), subdomain: z.string() }),
  z.strictObject({ status: z.literal("reserved") }),
  z.strictObject({ status: z.literal("invalid"), reason: subdomainFormatReasonSchema }),
]);

export const saveCatalogSubdomainSchema = z.strictObject({ subdomain: z.string().max(200) });
/** The repository's API error envelope ({ code, error, issues? } sent by apiError), narrowed to the catalog routes. */
const subdomainIssueSchema = z.object({ field: z.literal("subdomain"), reason: subdomainFormatReasonSchema }).loose();
export const catalogSettingsErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("INVALID_SUBDOMAIN"), error: z.string(), issues: z.tuple([subdomainIssueSchema]) }),
  z.object({
    code: z.enum(["SUBDOMAIN_RESERVED", "SUBDOMAIN_TAKEN", "SUBDOMAIN_REQUIRED", "INVALID_CATALOG_SETTINGS", "UNSUPPORTED_MEDIA_TYPE", "RATE_LIMITED", "SERVICE_UNAVAILABLE", "UNAUTHENTICATED", "COMPANY_REQUIRED"]),
    error: z.string(),
    issues: z.array(z.object({ field: z.string(), reason: z.string() }).loose()).optional(),
  }),
]).readonly();
```

**Error envelope.** The catalog routes send every error through the existing `apiError(response, status, code, message, issues?)` in `api-auth-middleware.ts`, so the body is the repository's envelope `{ code, error, issues? }`, validated by `apiErrorResponseSchema` before sending. There is no catalog-specific sender and no new field:
- The format reason of `INVALID_SUBDOMAIN` travels in the envelope's existing `issues` field, as `issues: [{ field: "subdomain", reason }]`. A top-level `reason` field is not added: `apiErrorResponseSchema` is a plain `z.object`, so `apiError` would silently strip it.
- T1 adds `INVALID_SUBDOMAIN`, `SUBDOMAIN_RESERVED`, `SUBDOMAIN_TAKEN`, `SUBDOMAIN_REQUIRED` and `RATE_LIMITED` to `apiErrorCodeSchema` in `shared/contracts/registration.ts`. Otherwise `apiErrorResponseSchema.parse` inside `apiError` throws on them. `INVALID_CATALOG_SETTINGS`, `UNSUPPORTED_MEDIA_TYPE` and `SERVICE_UNAVAILABLE` already exist.
- `catalogSettingsErrorSchema` is a non-strict `z.object` with `error: z.string()`, like `deliverySettingsApiErrorSchema` and `quotationApiErrorSchema`, so it accepts exactly what `apiError` sends.
- `shared/contracts/catalog.ts` exports `subdomainErrorReason(error)`, which returns the reason of an `INVALID_SUBDOMAIN` error, so neither client reads `issues[0]` itself.
- **Web** (`catalog-link-client.ts`): a non-2xx body below 500 is parsed with `catalogSettingsErrorSchema` and returned as `answered`. A body that fails it is `no_response`.
- **Mobile** (`catalog-settings-api.ts`): the shared `api-client` already requires `{ code: string, error: string }` on errors. It returns `API_ERROR` with `http.body` for the new codes, and `RATE_LIMITED` with `http.body` for 429. `catalog-settings-api.ts` parses `http.body` with `catalogSettingsErrorSchema`. `api-client.ts` and `transport-error.ts` do not change.

| Route | Success | Errors |
| --- | --- | --- |
| `GET /api/catalog/settings` | 200 `catalogSettingsSchema` | 503 `SERVICE_UNAVAILABLE` |
| `PUT /api/catalog/settings` `{ published }` | 200 settings | 400 `INVALID_CATALOG_SETTINGS`, 409 `SUBDOMAIN_REQUIRED`, 415, 503 |
| `GET /api/catalog/subdomain-availability?value=` | 200 `subdomainAvailabilitySchema` (also for `invalid` and `reserved`: a verdict, not an error) | 400 `INVALID_CATALOG_SETTINGS` (missing or over 200 characters), 429 `RATE_LIMITED`, 503 |
| `PUT /api/catalog/subdomain` `{ subdomain }` | 200 settings (same value: 200, no change) | 422 `INVALID_SUBDOMAIN` + `issues: [{ field: "subdomain", reason }]`, 422 `SUBDOMAIN_RESERVED`, 409 `SUBDOMAIN_TAKEN`, 400 `INVALID_CATALOG_SETTINGS` (body that fails the schema), 415, 503 |

- **Statuses:** a well-formed request that a business rule rejects (format or reserved) answers 422. A malformed body answers 400. A race lost to another company answers 409.
- **A `503` on `PUT /api/catalog/subdomain`:** both clients treat it as a save without an answer and re-read with `GET /api/catalog/settings`. A `PERSISTENCE_UNAVAILABLE` can follow a commit whose answer was lost, so the server cannot vouch for either outcome. Re-reading is safe, because the save is idempotent.
- **Access:** every route requires the seller session or bearer token with a company (the existing `requireApiCompany`), and answers `Cache-Control: no-store`.
- **Validation:** core validates its responses against the schemas before sending them, and its errors with `apiErrorResponseSchema` (inside `apiError`). Both clients validate every response and error body with the shared schemas.
- The legacy `url` meaning (`/catalogo/:id`) is gone.

**Storefront resource route** on the brand host: `/carrito`, a React Router route (not `/api`), web-only. Its schemas live in `features/catalog/presentation/cart-schemas.ts`:

| Request | Answer | Limit |
| --- | --- | --- |
| `GET ?v=` (refresh) | unchanged | none (unchanged) |
| `POST { intent: "continue", orderId, lines }` | today's answers | `allowCatalogOrder`, checked only for this intent |
| `POST { intent: "check_order", orderId }` | `200 { order: "confirmed" \| "not_confirmed" }`; `409 CATALOG_UNAVAILABLE` on an unavailable store; `400 INVALID_CART` on a bad body; `503` | `allowCatalogOrderCheck`, its own limiter; 429 `RATE_LIMITED` |

## 9. Events and cross-feature integration

No domain event. Cross-feature capabilities:

| Capability | Owner | Consumer | Shape |
| --- | --- | --- | --- |
| `orders.readCatalogOrderConfirmation(companyId, orderId)` | `orders/composition.ts` (new single-statement repository function) | `catalog/cart-composition.ts` (`checkCartOrder`) | `Promise<Result<"confirmed" \| "not_confirmed", { code: "PERSISTENCE_UNAVAILABLE" }>>`, under `withTenantIsolation(companyId)` |
| `orders.checkoutUrl(companyId, orderId)` | orders (existing) | catalog cart (existing) | Unchanged. The client now uses the whole URL. |
| `catalogStorefront.resolve(host)` | catalog | root middleware (`app/middleware/storefront.ts`) | `Promise<Result<Storefront, …>>` |
| `catalogLegacy.resolve(companyId)` | catalog | `app/routes/legacy-catalog-redirect.ts` | section 5.6 |
| Store appearance read (`catalogBrowse.storeAppearance`) | catalog (existing, using store-appearance) | root middleware, only for the themed not-found page | Existing. |

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| The buyer confirms, then the order check fails (offline, 503, 429) | The cart keeps its lines. **Continuar** reopens the confirmed order's checkout, which shows it as confirmed. | Accepted by the product. Nothing is duplicated or lost. |
| The buyer confirms in another browser | Same as above. | Accepted by the product. |
| Back button from the checkout restores a bfcache page | `pageshow.persisted` triggers the check. | Empty cart once the answer arrives. |
| The buyer never pressed **Continuar** with this cart | No check is sent. | Nothing to empty. |
| The seller hides the catalog or changes the subdomain while a buyer has the page open | `/carrito` answers `CATALOG_UNAVAILABLE` for refresh, **Continuar** and the check while the old name is free. If another company takes the name, the host resolves to that company; the lines show as no longer available, and the old cart lives under the previous company's key. | As the product defines. |

## 10. Mobile

| File | Change |
| --- | --- |
| `src/features/catalog/domain/` (new `catalog-link.ts`) | Screen model `CatalogLink = { published; subdomain \| null; url \| null; domain; suggestion \| null }`. `linkFieldState(value, saved, verdict)` (pure) maps the typed value, the saved subdomain and the latest verdict to the status line state of the product table. It reuses `parseCatalogSubdomain` and `isReservedCatalogSubdomain`, and says whether a server check is needed (only valid, non-reserved values that differ from the saved one). |
| `src/features/catalog/infrastructure/catalog-settings-api.ts` | `get()` and `setPublished()` parse the new schema. New `checkSubdomain(value)` and `saveSubdomain(subdomain)`. Error bodies come from `TransportError.http.body` (`API_ERROR` or `RATE_LIMITED`) and are parsed with `catalogSettingsErrorSchema`; the reason comes from `subdomainErrorReason`.<br>**Not sent versus no answer:** the shared `api-client` returns `NETWORK_ERROR` in both cases, so before a save `catalog-settings-api.ts` checks `expo-network` `getNetworkStateAsync()` (already used by `pending-order-sync-provider.tsx`). `isConnected === false` returns `{ kind: "not_sent" }` without sending.<br>Every other `NETWORK_ERROR`, `INVALID_RESPONSE`, `SERVER_ERROR`, `SERVICE_UNAVAILABLE` (503), or an error body that fails the schema, returns `{ kind: "no_response" }`. This is the safe default, because it re-reads. If the network state cannot be read, the save is sent. |
| `src/features/catalog/composition.ts` | Exposes the two new operations. |
| `src/features/catalog/presentation/hooks/use-catalog-link.ts` (new) | 400 ms debounce (initial value, adjustable). Drops the verdict on every edit. Calls the server only when `linkFieldState` says so. An `AbortController` and a request counter keep only the latest answer. `RATE_LIMITED` and network failures map to the check-failed state. After a save without an answer, it re-reads the settings and decides saved, not saved, or in doubt. It reports `hasUnsavedLink` (edited and different from the initial value). |
| `src/features/catalog/presentation/catalog-publication-card.tsx` | Two groups: the link (field with suffix `.{domain}`, status line, **Guardar link**, «Tu link», **Copiar link** and **Ver catálogo** while published) and the publication (switch disabled without a subdomain). Change confirmation with **Cambiar link** in destructive style. `autoCapitalize="none"`, `autoCorrect={false}`, `keyboardType="url"`, `returnKeyLabel`/`returnKeyType` set to «Guardar». Final verdicts announced with `AccessibilityInfo.announceForAccessibility`. |
| `src/features/catalog/presentation/catalog-settings-screen.tsx` | Selectable, wrapping `Text` for the URL. «Link de tu catálogo» label. Three states (published, hidden with a subdomain, hidden without one). **Ir a Apariencia de la tienda** pushes `/settings/appearance?focus=catalog`. Keeps re-reading on focus. |
| `src/features/catalog/presentation/translations.ts` | New es and pt-BR texts. |
| `src/features/store-appearance/presentation/store-appearance-screen.tsx` | The publication slot receives `onUnsavedLinkChange`. The leave guard combines the draft with `hasUnsavedLink` and picks one of the three descriptions. `focus=catalog` opens **Editar** scrolled to the card without focusing the field. The scroll view keeps the field, the status line and **Guardar link** above the keyboard and the save bar (`KeyboardAvoidingView` or `scrollToFocusedInput`, following the screen's current pattern). |
| `src/app/(tabs)/settings/appearance.tsx`, `src/app/(tabs)/settings/index.tsx` | Pass the `focus` parameter. Row description «Logo, tema, link y publicación de tu catálogo». |

No local SQLite data. No sync queue.

| Situation | Decision |
| --- | --- |
| Availability request fails or is rate-limited | «No pudimos revisar si está disponible.» with **Reintentar**. **Guardar link** stays enabled. |
| Save not sent | «No pudimos guardar tu link. Revisa tu conexión.» with **Reintentar**. |
| Save without an answer, or answered `503` | Re-read once. Saved, not saved, or a failed re-read follow the product table. **Reintentar** resends the same `PUT`, which is idempotent. |
| `SUBDOMAIN_REQUIRED` on publish | The switch goes back to off with «Elige el link de tu catálogo para poder publicarlo.». |

## 11. Transactions and concurrency

1. **Save subdomain.**
   - `withTenantIsolation(companyId)` reads the current value, then runs one `prisma.company.update({ where: { id }, data: { catalogSubdomain } })`.
   - No explicit lock. The unique index serializes two companies saving the same value: exactly one commits, and the other gets `23505` → `SUBDOMAIN_TAKEN`.
   - Two saves by the same company: the last one wins. Each one releases its own previous value in its commit.
   - The read before the update only decides `unchanged` and `first`/`replaced` for the response. If a parallel save by the same company changes it in between, the stored value is still consistent.
2. **Publish.**
   - One conditional `UPDATE … WHERE id = $1 AND "catalogSubdomain" IS NOT NULL`, with the `CHECK` as the backstop.
   - A subdomain cannot be removed, so no race can leave a published catalog without one.
3. **Storefront resolution.**
   - One `systemPrisma` round trip per request, through the function.
   - Later reads of the same request (products, variants, appearance) run under the resolved company's context, as today.
   - A change between the resolution and those reads gives the "open page on a changed address" outcome defined by the product.
4. **Continuar.** Unchanged (existing transaction, same id returns the same order).
5. **Order check.** One read. Concurrent checks and a concurrent confirmation are independent: a check that reads before the confirmation commits answers `not_confirmed`, and the next document load or bfcache restore asks again.

Duplicate policy:
- A repeated save of the same value is a success with no write.
- A repeated publish is idempotent.
- Repeated **Continuar** uses today's id rule.
- Repeated order checks are reads, bounded per document and per IP.

## 12. Code organization

### Core: catalog feature

| File | Change |
| --- | --- |
| `domain/store-host.ts` (+ test) | `StoreHost`, `classifyHost`. |
| `application/catalog-settings.ts` (+ test) | `getCatalogSettings` (modified), `setCatalogPublication` (modified), `checkSubdomainAvailability`, `saveCatalogSubdomain` (new, in the same file because they share access, deps and errors). |
| `application/resolve-storefront.ts` (+ test) | `resolveStorefront`, `resolveLegacyCatalogLink`. |
| `application/check-cart-order.ts` (+ test) | `checkCartOrder`. |
| `infrastructure/catalog-settings-repository.ts` (+ integration test) | `readCatalogSettings`, `savePublication`, `saveSubdomain`, `resolveSubdomain`. Replaces `readPublished` and `savePublished`. |
| `infrastructure/storefront-config.ts` (+ test) | Section 6.3. |
| `presentation/settings-response.ts` | `toCatalogSettingsResponse(settings)` using `storeUrl` and `storeDomain`. `catalogUrl` is removed. |
| `presentation/api-routes.ts` (+ integration test) | New availability and subdomain routes; the `SUBDOMAIN_REQUIRED`, 422 and 429 mappings. |
| `presentation/rate-limit.ts` (+ test) | `allowSubdomainCheck` (T1); `allowCatalogOrderCheck` (T4). |
| `presentation/cart-schemas.ts` | `intent`-discriminated action body (T4). |
| `composition.ts` | `catalogSettings.{get, setPublication, checkSubdomain, saveSubdomain}` (T1); `catalogStorefront.resolve`, `catalogLegacy.resolve` (T4). |
| `browse-composition.ts`, `cart-composition.ts` | Take the resolved storefront: access and `readStore` from it; `catalogCart.checkOrder` (T4). |
| `index.ts` | Exports what `app/` and `app.ts` consume: `catalogStorefront`, `catalogLegacy`, `classifyHost`, `storefrontConfig` (T4). |

### Core: orders feature

| File | Change |
| --- | --- |
| `infrastructure/order-repository.ts` | `readCatalogOrderConfirmation`: one `findFirst` with `select: { checkoutConfirmedAt: true }` on `{ companyId, id, fromCatalog: true }`, or the equivalent `$queryRaw`. No aggregate, no logging of order fields. |
| `composition.ts` | Exposes `readCatalogOrderConfirmation(companyId, orderId)` under `withTenantIsolation`. |

### Core: app entry and web

| File | Change |
| --- | --- |
| `src/app.ts` | After `/health` and before `/api/auth`: `brandHostEdge` middleware (section 2, "Brand host edge answers"). |
| `src/shared/infrastructure/logger.ts` | `storeHost` field on `http_request_completed`. |
| `src/server.ts`, `app/entry.server.tsx` | `createRequestContext(req.ip, req.hostname)`. |
| `app/request-host-context.ts` (new) | `requestHostContext = createContext<string \| null>(null)`. |
| `app/storefront-context.ts` (new) | `storefrontContext = createContext<Storefront \| null>(null)`; `null` on the app host. |
| `app/middleware/storefront.ts` (+ test) | Root middleware, after `i18nextMiddleware`:<br>1. classify the host;<br>2. on a store or invalid host, let `/__manifest` through before any lookup;<br>3. resolve the storefront;<br>4. set the context, then let `/carrito` through or throw according to section 2.<br>`isStorefrontPath(pathname)` is the closed list. It normalizes single-fetch paths (`/_root.data` is `/`, `/productos/:id.data` is the product page). The resolver is not cached: a hide must take effect on the next request, and the lookup is one unique-index probe. It throws `data({ kind: "catalog_unavailable" }, 404)`, `data({ kind: "store_not_found", header }, 404)` with the store name and appearance, or `data({ kind: "catalog_load_error" }, 503)`. |
| `app/root.tsx` | `middleware = [i18nextMiddleware, storefrontMiddleware]`. The `ErrorBoundary` renders the three storefront kinds with `catalog-sections` components, and otherwise the generic error as today. |
| `app/routes.ts` | `index("routes/legacy-redirect.ts")` is replaced by `layout("routes/catalog-layout.tsx", [index("routes/catalog.tsx"), route("productos/:productId", "routes/catalog-product.tsx"), route("carrito", "routes/catalog-cart.tsx")])`.<br>`catalogo/:companyId` and `catalogo/:companyId/productos/:productId` → `routes/legacy-catalog-redirect.ts`.<br>`catalogo/:companyId/carrito` → `routes/legacy-catalog-cart.ts` (T4).<br>Only T4 edits this file. |
| `app/routes/catalog-layout.tsx` (new) | Middleware for the app host: `/` → 308 `/es-PE/` with the query (today's `legacy-redirect.ts` loader, which is deleted); other storefront paths → generic 404. Renders `<Outlet/>` on brand hosts. |
| `app/routes/catalog.tsx`, `catalog-product.tsx`, `catalog-cart.tsx` | Read `storefrontContext` instead of `params.companyId`. Product links `/productos/:id`. **Volver al catálogo** → `/`. The cart action dispatches by `intent` before any rate limit, and applies each intent's own limiter. Headers and `noindex` kept. |
| `app/routes/legacy-catalog-redirect.ts`, `legacy-catalog-cart.ts` (new) | Section 5.6, and the catalog-turned-off outcome for the cart. |
| `app/components/catalog-sections.tsx` | New `StoreNotFound` (header, «No encontramos esta página», «Revisa el link o mira los productos de la tienda.», **Volver al catálogo**). |
| `app/components/catalog-cart.tsx` | Route `/carrito`. `window.location.assign(body.checkoutUrl)`. Marks the cart `continued` when **Continuar** returns a checkout URL. Runs the order check once per document load (module-level flag) and on `pageshow.persisted`, only when the cart has lines and `continued` is true. |
| `app/lib/catalog-cart-storage.ts` | `continued` in the cart schema (optional, default `false`). `withLines` drops it when it rotates the id. `markContinued(companyId, orderId)`. `clearCartForOrder` kept, now called by the storefront when the check answers `confirmed`. |
| `app/routes/checkout.tsx` | The `clearCartForOrder` effect is removed. |
| `app/lib/catalog-link-client.ts` (new, + test) | T2. Plain-`fetch` client for check, save and re-read (section 2, "Web transport for the link"). |
| `app/components/catalog-publication-card.tsx`, `app/routes/store-appearance-settings.tsx`, `app/components/store-appearance-editor-actions.ts`, `app/routes/catalog-settings.tsx`, `app/locales.ts` | Seller UI (T2):<br>- link group, using `catalog-link-client.ts`; the editor's loader, action and `shouldRevalidate` gain only the settings fields the card seeds from. The loader reads `readCatalogSettings` instead of `readPublished`. While the company has no subdomain, this adds one suggestion probe (one indexed round trip) per load and per revalidation after **Guardar cambios**. Accepted: it is needed to show the suggestion, and it stops once a link is saved;<br>- change confirmation;<br>- unsaved-link leave descriptions;<br>- Settings → Catálogo text and states;<br>- scroll to the card (`#catalog-publication`). |

### Config and infrastructure files

| File | Change |
| --- | --- |
| `compose.yaml` (`web`) | `CATALOG_BASE_URL: ${CATALOG_BASE_URL:-http://localhost:${WEB_PORT:-3000}}`. |
| `compose.prod.yaml` (`web`) | `CATALOG_BASE_URL: ${CATALOG_BASE_URL:?CATALOG_BASE_URL is required}`. The worker does not get it. |
| `apps/core/.env.example` | `CATALOG_BASE_URL=http://localhost:3000`, with a comment: brand hosts open at `http://<subdomain>.localhost:3000/`. |
| `apps/core/scripts/run-tests.sh` | `CATALOG_BASE_URL=http://localhost:${CORE_E2E_PORT:-4173}` for e2e; `http://localhost:3000` otherwise. |
| `apps/core/tests/e2e/fixtures.ts` | Chromium launch arg `--host-resolver-rules=MAP *.localhost 127.0.0.1`; helper `storeUrl(subdomain, path)`; helper `publishCatalog(companyId, subdomain)` (direct, for buyer specs). |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `catalog_subdomain_saved` | info | catalog composition, after commit | `["companyId", "userId", "change"]` (`first` \| `replaced`; `unchanged` does not log) |
| `catalog_subdomain_rejected` | debug | catalog composition | `["companyId", "userId", "errorCode", "reason"]` |
| `catalog_subdomain_check_rate_limited` | warn | availability presentation, first rejection per user per window only | `["companyId", "userId"]` |
| `unable_to_save_catalog_subdomain` | error | settings repository | `["companyId", "errorCode", "err"]` |
| `catalog_publication_changed` | info | catalog composition (existing) | `["companyId", "userId", "published"]` |
| `catalog_publication_rejected` | debug | catalog composition | `["companyId", "userId", "errorCode"]` (`SUBDOMAIN_REQUIRED`) |
| `unable_to_read_catalog` | error | settings repository (existing event; the only log of these failures) | `["companyId?", "operation", "errorCode", "err"]`, `operation`: `read_settings`, `resolve_subdomain` (no `companyId`: it is unknown before the lookup) |
| `catalog_order_check_rate_limited` | warn | cart route, first rejection per IP per window only | `["companyId"]` |
| `unable_to_check_cart_order` | error | orders repository | `["companyId", "errorCode", "err"]` |
| `http_request_completed` | info | existing request logging | new `operation` values: `get_catalog_settings`, `check_catalog_subdomain`, `save_catalog_subdomain`, `set_catalog_publication`, `resolve_storefront`, `legacy_catalog_link`, `check_cart_order`; `outcome`; plus `storeHost: "app" \| "store" \| "invalid"` |

- **Logged once:** the middleware and the use cases propagate the `Result` without logging it again (guide 4.6). A failed resolution is logged only by the repository.
- **Never logged:**
  - the typed or saved subdomain (it can be a person's name);
  - the `Host` header and the request URL of a brand host;
  - `orderId` (a checkout credential) and the order number;
  - cart contents.
- **Not logged at all:** resolution misses for unknown hosts and the edge answers (`robots.txt`, scanner paths). They are expected and come from anyone.
- New Relic keeps excluding headers and URLs (`apps/core/newrelic.cjs`). `apm-privacy.test.ts` keeps passing.

## 14. Tests

### Shared and core unit

`shared/catalog-subdomain.test.ts`:
- `test("accepts fantasio, fantasio-store and 3 to 30 lowercase letters, digits and single hyphens")`
- `test("reports contains_domain for fantasio.yoyos.lat and https://fantasio")`
- `test("reports contains_space for a value pasted with a trailing space")`
- `test("reports invalid_character for café and Café- before any other reason")`
- `test("reports too_long for a 40 character value")`
- `test("reports hyphen_edge for fantasio- and for a leading hyphen of one or two characters")`
- `test("reports double_hyphen for fan--tasio")`
- `test("reports too_short for fa")`
- `test("treats every name of the product reserved list as reserved")`
- `test("suggests cafe-fantasio for «Café Fantasío», cut to 30 characters without edge hyphens")`
- `test("suggests nothing when the converted company name is shorter than 3 characters")`

`apps/core/src/features/catalog/domain/store-host.test.ts`:
- `test("classifies fantasio.yoyos.lat as a store host with subdomain fantasio")`
- `test("classifies a reserved but well-formed label like tienda or pay as a store host, not invalid")`
- `test("classifies the app hostname, IPs, localhost and the base apex as the app host")`
- `test("classifies a.b.yoyos.lat, a label with a double hyphen and a two character label as invalid")`
- `test("ignores the port and a trailing dot and lowercases the hostname")`

`apps/core/src/features/catalog/infrastructure/storefront-config.test.ts`:
- `test("builds https://fantasio.yoyos.lat/ and the .yoyos.lat suffix from https://yoyos.lat")`
- `test("keeps the port in dev: http://fantasio.localhost:3000/")`
- `test("rejects a base URL with a path, an IP host, or http in production")`
- `test("rejects the Coolify placeholder text and a missing value in production")`

`apps/core/src/features/catalog/application/catalog-settings.test.ts`:
- `test("returns the available suggestion when the company has no subdomain")`
- `test("returns no suggestion when it is taken, reserved, too short or its lookup fails")`
- `test("answers current for the saved subdomain even after it became reserved")`
- `test("answers invalid without any lookup")`
- `test("answers in_use without revealing which company holds the name")`
- `test("saving the current subdomain succeeds without writing, also when it became reserved")`
- `test("rejects saving a reserved, invalid or too short subdomain and writes nothing")`
- `test("reports SUBDOMAIN_TAKEN and keeps the previous subdomain when the save loses the race")`
- `test("reports first for the first subdomain and replaced for a change")`
- `test("rejects publishing without a saved subdomain with SUBDOMAIN_REQUIRED")`
- `test("hides the catalog with or without a subdomain")`

`apps/core/src/features/catalog/application/resolve-storefront.test.ts`:
- `test("resolves the published store whose subdomain matches the host with one lookup")`
- `test("keeps serving a published store whose subdomain was later added to the reserved list")`
- `test("returns the same unavailable for an unknown, released, unowned reserved, malformed or hidden host")`
- `test("redirects a legacy link only when the company has a subdomain and a published catalog")`

`apps/core/src/features/catalog/application/check-cart-order.test.ts`:
- `test("answers confirmed for a confirmed catalog order of the store")`
- `test("answers not_confirmed for a pending, missing or other company order")`

`apps/core/src/features/catalog/presentation/rate-limit.test.ts`:
- `test("check_order requests do not consume the Continuar budget")`
- `test("the subdomain check limiter counts per user and refuses the 61st call in a minute")`
- `test("reports only the first rejection per key per window")`

`apps/core/app/middleware/storefront.test.ts`:
- `test("serves only /, /productos/:productId and /carrito on a published store host")`
- `test("normalizes /_root.data and /productos/:id.data")`
- `test("lets /__manifest through on a store host without a lookup")`
- `test("throws store_not_found with the store header for /login on a published store host")`
- `test("throws catalog_unavailable for documents and other paths on an unknown or hidden store host")`
- `test("lets /carrito through with an unavailable storefront instead of throwing")`
- `test("puts the resolved store in the context so the loaders do not read it again")`
- `test("leaves app host requests untouched")`

`apps/core/app/lib/catalog-cart-storage.test.ts`:
- `test("clears the cart when the storefront learns its order was confirmed and keeps another order's cart")`
- `test("drops the continued flag when the cart content changes its order id")`

`apps/core/app/components/catalog-cart.test.tsx`:
- `test("checks the order once per document load and on pageshow persisted when the continued cart has lines, and empties it only on confirmed")`
- `test("sends no order check when the cart was never continued")`
- `test("keeps the cart when the order check fails or is rate-limited")`
- `test("Continuar navigates to the full checkout URL on the app host")`

### Web seller UI

`apps/core/app/lib/catalog-link-client.test.ts`:
- `test("returns not_sent without calling fetch when the browser is offline")`
- `test("returns no_response when fetch rejects, times out, answers 5xx or sends a body that fails the schema")`
- `test("returns answered with the parsed body for 200, 409, 422 and 429")`

`apps/core/app/components/catalog-publication-card.test.tsx` and `app/routes/store-appearance-editor.test.tsx`:
- `test("shows the help text, then after the pause one reason by priority, and keeps a 40 character paste whole with «Usa hasta 30 caracteres.»")`
- `test("typing fantasio-store quickly never shows the hyphen reason")`
- `test("decides invalid, reserved and current locally without calling the availability route")`
- `test("enables Guardar link only for available and check failed, and Enter does nothing otherwise and never submits the appearance draft")`
- `test("shows «Alguien acaba de tomar …» after an available verdict and the plain in-use text after a failed check")`
- `test("shows the check-failed state with Reintentar when the availability route answers 429")`
- `test("asks «¿Cambiar el link de tu catálogo?» before replacing a saved link, saves nothing on Mantener link actual and returns focus to Guardar link")`
- `test("a save that was not sent shows «No pudimos guardar tu link. Revisa tu conexión.» with Reintentar")`
- `test("a save without an answer re-reads and shows Link guardado, Tu link no se guardó, or the in-doubt message with Reintentar")`
- `test("disables the switch with «Elige el link de tu catálogo para poder publicarlo.» until a link is saved")`
- `test("while hidden shows «Tu link» without Copiar link or Ver catálogo")`
- `test("a failed availability check keeps the editor, the logo and theme draft and the typed link, and shows «No pudimos revisar si está disponible.» in the status line")`
- `test("a save without an answer whose re-read also fails keeps the editor, the draft and the typed link, with the in-doubt message and Reintentar")`
- `test("a save answered 503 re-reads the settings instead of showing a save error")`
- `test("saving the link does not revalidate the editor loaders or re-read the preview products")`
- `test("the editor loader makes the suggestion probe only while the company has no subdomain")`
- `test("set-publication keeps not revalidating the editor loaders")`
- `test("leaving with only a pending link, only a draft, or both shows the matching description")`
- `test("an untouched suggestion and a link edited back to its initial value ask nothing on leave")`
- `test("Guardar cambios with a pending link saves only logo and theme and keeps the link status line")`

`apps/core/app/routes/catalog-settings.test.tsx`:
- `test("published shows «Link de tu catálogo» with the full brand URL as wrapping text, Copiar link and Ver catálogo")`
- `test("hidden with a subdomain and hidden without one show their texts and no link")`
- `test("Ir a Apariencia de la tienda links to the Publicar catálogo card")`

### Core integration

`apps/core/src/features/catalog/infrastructure/catalog-settings-repository.integration.test.ts`:
- `test("two companies saving fantasio at the same time: exactly one keeps it, the other gets SUBDOMAIN_TAKEN")`
- `test("changing the subdomain releases the previous one for another company in the same commit")`
- `test("the database rejects a published catalog without a subdomain")`
- `test("the database rejects a subdomain outside the format")`
- `test("resolves owner, publication and store of a subdomain across companies in one call without exposing other company rows")`
- `test("a company cannot update another company's subdomain")`

`apps/core/src/features/orders/infrastructure/order-repository.integration.test.ts`:
- `test("reads the confirmation of a catalog order of the company and answers not_confirmed for another company's order")`

`apps/core/src/features/catalog/presentation/api-routes.integration.test.ts`:
- `test("settings API returns subdomain, brand url, domain and suggestion")`
- `test("availability API answers available, current, in_use, reserved and invalid with reason")`
- `test("availability API answers 429 RATE_LIMITED after the per-user limit")`
- `test("subdomain API saves, repeats the same value as success, and answers 422 for invalid and reserved and 409 for taken")`
- `test("the real 422 INVALID_SUBDOMAIN, 422 SUBDOMAIN_RESERVED, 409 SUBDOMAIN_TAKEN, 409 SUBDOMAIN_REQUIRED and 429 RATE_LIMITED bodies parse with apiErrorResponseSchema and catalogSettingsErrorSchema, and subdomainErrorReason returns the format reason")`
- `test("publishing without a subdomain answers 409 SUBDOMAIN_REQUIRED and keeps the catalog hidden")`
- `test("catalog settings routes reject requests without a session")`

`apps/core/src/app.integration.test.ts` (or the existing app route test file):
- `test("any /api path on a store host answers 404 without reaching auth or routers")`
- `test("robots.txt and scanner paths on a store host answer without a database query")`

`apps/core/app/routes/catalog.test.ts`, `catalog-page.test.tsx` and `catalog-cart.test.ts` (route modules with a controlled `Host`):
- `test("the grid on fantasio.localhost shows Fantasio products and sends noindex and no-referrer")`
- `test("an unknown host and a hidden catalog's host render byte-identical «Catálogo no disponible» bodies")`
- `test("a product of another company on Fantasio's host shows the product no longer available with 404")`
- `test("Continuar on Fantasio's host with another company's variants creates no order")`
- `test("refresh, Continuar and check_order on a just-hidden or just-released host answer CATALOG_UNAVAILABLE as JSON")`
- `test("check_order answers confirmed only for this store's confirmed order")`
- `test("Continuar answers the full checkout URL on the app host")`
- `test("legacy /catalogo/:id/productos/:pid?x=1 redirects 308 with no-store to the brand product URL with the query")`
- `test("legacy product link of another company's product still redirects, and the brand host answers no longer available")`
- `test("legacy /catalogo/:id shows Catálogo no disponible when hidden or without subdomain")`
- `test("legacy cart POST answers CATALOG_UNAVAILABLE")`
- `test("/ on the app host keeps redirecting to /es-PE/ and /productos/:id answers the generic 404")`

`apps/core/src/features/catalog/browse-catalog.integration.test.ts`, `continue-to-checkout.integration.test.ts`: existing titles kept, with fixtures that set the subdomain.

### Mobile (Jest + RNTL)

`apps/mobile/src/features/catalog/domain/catalog-link.test.ts`:
- `test("maps every product status line state from the typed value, the saved link and the latest verdict")`
- `test("needs a server check only for a valid, non-reserved value that differs from the saved link")`

`apps/mobile/src/features/catalog/infrastructure/catalog-settings-api.test.ts`:
- `test("parses settings, availability and subdomain errors with the shared contract")`
- `test("reads taken, reserved and invalid with its reason from the TransportError http body")`
- `test("returns not_sent without sending when expo-network reports no connection")`
- `test("returns no_response for NETWORK_ERROR, INVALID_RESPONSE, 5xx and an error body that fails the schema")`

`apps/mobile/src/features/catalog/presentation/catalog-publication-card.test.tsx`:
- `test("prefills the available suggestion and keeps the switch disabled until the link is saved")`
- `test("shows only the verdict for the latest value after the pause and never announces Revisando")`
- `test("lowercases Fantasio while typing and keeps a 40 character paste whole with its reason")`
- `test("asks before replacing a saved link and saves nothing on Mantener link actual")`
- `test("shows Alguien acaba de tomar after an available verdict and the plain in-use text after a failed check")`
- `test("shows the check-failed state when the availability check is rate-limited")`
- `test("a save without an answer re-reads and shows Link guardado or Tu link no se guardó")`
- `test("the return key saves only when Guardar link is enabled")`

`apps/mobile/src/features/catalog/presentation/catalog-settings-screen.test.tsx`:
- `test("shows the full brand link with Copiar link, Compartir and Ver catálogo while published")`
- `test("shows the hidden texts with and without a subdomain and no link to share")`

`apps/mobile/src/features/store-appearance/presentation/store-appearance-screen.test.tsx`:
- `test("leaving with an edited link asks with the link description and an untouched suggestion asks nothing")`

### Web E2E (happy path only)

- `apps/core/tests/e2e/public-catalog.spec.ts`: `test("buyer opens fantasio's brand host, adds two variants, continues to the app checkout, confirms and finds an empty cart back in the store")`
- `apps/core/tests/e2e/catalog-link.spec.ts`: `test("seller chooses fantasio in Apariencia de la tienda, saves it, publishes and copies http://fantasio.localhost:4173/ from Settings → Catálogo")`
- `apps/core/tests/e2e/public-catalog-theme.spec.ts`: the existing titles, run on the brand host.

### Pending manual checks

- After the infra steps:
  - `https://<test>.yoyos.lat/` over HTTPS with no certificate warning on a phone (Chrome Android, Safari iOS) and in the Instagram in-app browser;
  - `http://<test>.yoyos.lat/` typed by hand, which must land on `https://`.
- Back button from the confirmed checkout to the store in Safari iOS (bfcache) shows an empty cart.
- Mobile on a physical device:
  - the status line and **Guardar link** stay visible above the keyboard;
  - the return key reads «Guardar»;
  - TalkBack and VoiceOver announce only final verdicts.
- The `curl` checks in section 16 (Infra) after the deploy.

## 15. Limits and checks during implementation

- **React Router middleware paths.** Confirm that React Router 7.9 runs root middleware for `.data` requests with the pathname normalized, including `/_root.data` for client navigation to `/` (**Volver al catálogo**). Confirm whether `/__manifest` (lazy route discovery) reaches the middleware. If it does, it is let through before the lookup. The middleware test titles cover the result once verified.
- **Root `ErrorBoundary`.** Confirm that a root `ErrorBoundary` without a `Layout` export renders a complete document in this app (`root.tsx` renders `<html>` in `App`). If not, add a `Layout` export, so the boundary keeps head, scripts and the fixed color scheme of themed pages.
- **`/carrito` behind the middleware.** Confirm that a middleware which sets context and calls `next()` for `/carrito` leaves the resource route's JSON responses untouched (no HTML boundary).
- **Hostname behind Traefik.** Confirm that `req.hostname` behind Coolify's Traefik is the brand host (`X-Forwarded-Host`). A container-level smoke test after the deploy: `curl -H 'Host: fantasio.yoyos.lat' http://127.0.0.1:3000/` inside the container.
- **`*.localhost` in E2E.** Resolution in Chromium is native. The `--host-resolver-rules` flag removes the dependency on IPv6 `::1` versus `127.0.0.1`.
- **Physical-device mobile dev.** A phone on a LAN IP cannot open `*.localhost`. A developer who needs it sets `CATALOG_BASE_URL=http://<ip>.nip.io:3000`. This is documentation only, not code.
- **Static assets.** `/assets/*`, fonts and the favicon are served by `express.static` before the middleware on every host, which the brand pages need.
- **Editor preview.** The store-appearance preview iframe stays on the app host and renders catalog components without links. T4 verifies that its product cards do not link to `/catalogo/:id`, because T4 owns `catalog-sections.tsx` and removes the prefixes (T4 acceptance criterion 10).
- **In-memory limiters.** They reset per process and are per instance, the same as `allowCatalogOrder` today. Acceptable for one `web` instance.
- **Per-IP key behind Cloudflare** (known limitation, deferred with real risk in section 2). After the deploy, check once which address `req.ip` holds on a brand-host request, for example with a temporary debug log of whether it falls in a Cloudflare range, and record it in the pull request.
- **Migration as one file.** `add_catalog_subdomain` deliberately keeps the column, the constraints and the function in one file with explicit `BEGIN`/`COMMIT`: hiding the catalogs and adding the `CHECK` must be atomic. This departs from the repository habit of a separate SQL-only migration for each `SECURITY DEFINER` function; those migrations carry no `BEGIN`/`COMMIT`. Prisma runs a `migration.sql` that contains a function body as one script (repository memory). T1 verifies this with `prisma migrate dev` on a clean database. It must not split the file.
- **Left out on purpose:** custom domains, subdomain history, a cooling period, moving the cart between hosts, visit metrics (product draft), and the `refreshCart` image N+1 (section 2, deferred).
- **One level only.** Universal SSL covers `*.yoyos.lat`. The format forbids dots, so deeper names never become brand hosts.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T1 Backend settings, contract, schema and config
Wave 2:  T2 Web seller UI   ║  T3 Mobile seller UI  ║  T4 Brand host serving, legacy redirect and cart
                     (all three depend only on T1, and touch disjoint files)
Then:    final verification; the coordinator promotes the documentation
Infra (founder, manual): before the final merge; see "Merge preconditions"
```

File ownership in wave 2. Every file a task edits or creates is listed. A file not listed belongs to no wave-2 task.

**T2:**
- `apps/core/app/components/catalog-publication-card.tsx` (+ `.test.tsx`)
- `apps/core/app/components/store-appearance-editor-actions.ts`
- `apps/core/app/lib/catalog-link-client.ts` (new, + `.test.ts`)
- `apps/core/app/routes/store-appearance-settings.tsx` (+ `.test.ts`)
- `apps/core/app/routes/store-appearance-editor.test.tsx`
- `apps/core/app/routes/catalog-settings.tsx` (+ `.test.tsx`)
- `apps/core/app/locales.ts` (+ `locales.test.ts`), the single web text file. T4 adds no text there: the storefront texts, `StoreNotFound` included, stay hard-coded in the catalog modules, as today.
- `apps/core/tests/e2e/catalog-link.spec.ts`

**T3:** only `apps/mobile/**`.

**T4:**
- Server entry:
  - `apps/core/src/app.ts` (+ app route integration test)
  - `apps/core/src/server.ts`
  - `apps/core/src/shared/infrastructure/logger.ts`
- App entry and routing:
  - `apps/core/app/entry.server.tsx`
  - `apps/core/app/root.tsx`
  - `apps/core/app/routes.ts`
  - `apps/core/app/request-host-context.ts`, `apps/core/app/storefront-context.ts`
  - `apps/core/app/middleware/storefront.ts` (+ test)
- Storefront routes:
  - `apps/core/app/routes/catalog.tsx`, `catalog-product.tsx`, `catalog-cart.tsx` and their tests `catalog.test.ts`, `catalog-page.test.tsx`, `catalog-cart.test.ts`
  - `apps/core/app/routes/catalog-layout.tsx`
  - `apps/core/app/routes/legacy-catalog-redirect.ts`, `legacy-catalog-cart.ts`
  - `apps/core/app/routes/legacy-redirect.ts` (deleted)
  - `apps/core/app/routes/checkout.tsx` (+ `checkout.test.ts`)
- Components and cart storage:
  - `apps/core/app/components/catalog-sections.tsx` (+ test)
  - `apps/core/app/components/catalog-cart.tsx` (+ `catalog-cart.test.tsx`)
  - `apps/core/app/lib/catalog-cart-storage.ts` (+ test)
- Catalog feature:
  - `apps/core/src/features/catalog/composition.ts`, `index.ts`, `browse-composition.ts`, `cart-composition.ts`
  - `apps/core/src/features/catalog/presentation/cart-schemas.ts`, `presentation/rate-limit.ts` (+ test; T1 created `allowSubdomainCheck` there in wave 1)
  - `apps/core/src/features/catalog/application/resolve-storefront.ts`, `check-cart-order.ts` (+ tests)
  - `apps/core/src/features/catalog/domain/store-host.ts` (+ test)
  - `apps/core/src/features/catalog/browse-catalog.integration.test.ts`, `continue-to-checkout.integration.test.ts`
- Orders feature: `apps/core/src/features/orders/composition.ts`, `infrastructure/order-repository.ts` (+ integration test)
- E2E:
  - `apps/core/tests/e2e/public-catalog.spec.ts`, `public-catalog-theme.spec.ts`, `store-appearance-buyer.spec.ts`
  - `apps/core/tests/e2e/fixtures.ts`

### T1. Backend settings, contract, schema and config

**Scope:**
- Migration `add_catalog_subdomain` (section 7) and `schema.prisma`.
- `shared/catalog-subdomain.ts` and the new `shared/contracts/catalog.ts`, including `catalogSettingsErrorSchema` and `subdomainErrorReason`.
- The five new codes in `apiErrorCodeSchema` (`shared/contracts/registration.ts`); the catalog routes send errors through `apiError` (section 8, "Error envelope").
- Use cases 5.1–5.4, and the repository functions including `resolveSubdomain`.
- `storefront-config.ts`, with `storeUrl` and `storeDomain`.
- `toCatalogSettingsResponse`.
- JSON API routes and their error mapping (422, 409, 429).
- `allowSubdomainCheck` and the optional `onFirstRejection` callback in `rate-limit.ts`.
- Composition (`catalogSettings.checkSubdomain`, `.saveSubdomain`) and logs.
- `CATALOG_BASE_URL` in `compose.yaml`, `compose.prod.yaml` (`web` and `migrate`), `.env.example` and `run-tests.sh`.
- The `migrate` guard (section 2, "A missing or invalid `CATALOG_BASE_URL`").
- The `yoyos-stores` Traefik labels on `web` in `compose.prod.yaml` (section 16, Infra step 2). They are versioned with the code, and they also reach staging, where they are harmless because no `yoyos.lat` traffic arrives there.
- Existing fixtures and specs that set `catalogPublished: true` now also set a subdomain. This includes `public-catalog-theme.spec.ts:15` and `store-appearance/presentation/api-routes.integration.test.ts`.
- `public-catalog.spec.ts` seeds the subdomain through the database before the seller publishes, so CI stays green while the catalog is still served at `/catalogo/:id`.
- The web «Apariencia de la tienda» publish action maps `SUBDOMAIN_REQUIRED` to the existing failed-save outcome. The new message is added by T2.

**Out of scope:** seller UI, brand-host serving, legacy redirect, cart check.

**Acceptance criteria:**
1. `GET /api/catalog/settings` for «Café Fantasío» without a subdomain answers `{ published: false, subdomain: null, url: null, domain: "localhost:3000", suggestion: "cafe-fantasio" }`. If another company holds `cafe-fantasio`, `suggestion` is `null`.
2. `GET /api/catalog/subdomain-availability?value=…`:
   - `pay` answers `{ status: "reserved" }`;
   - `fa` answers `invalid` / `too_short`;
   - `fantasio-` answers `invalid` / `hyphen_edge`;
   - a name of another company answers `in_use`;
   - a free name answers `available`;
   - the 61st call by one user within a minute answers 429.
3. `PUT /api/catalog/subdomain`:
   - with `pay`, `fa`, `-fantasio`, `fan--tasio` or `café`, it answers 422, and the company keeps no subdomain;
   - with `fantasio`, it answers 200 and `url: "http://fantasio.localhost:3000/"`;
   - repeating it answers 200 without logging `catalog_subdomain_saved`.
4. Two concurrent `PUT`s of `fantasio` from two companies: one gets 200 and the other gets 409 `SUBDOMAIN_TAKEN` and keeps its previous value.
5. `PUT /api/catalog/settings { published: true }` without a subdomain answers 409 `SUBDOMAIN_REQUIRED`. After saving a subdomain it answers 200 `published: true`.
6. After the migration, a company that was published is hidden, and no company has a subdomain.
7. Core starts with `NODE_ENV=production` only when `CATALOG_BASE_URL` is a valid `https` URL. The placeholder text fails with a message naming the variable.
8. `docker compose -f compose.prod.yaml config` renders the labels with a single `$` in the regex. Running the `migrate` command with `CATALOG_BASE_URL="CATALOG_BASE_URL is required"` exits 1 before `scripts/migrate.ts`.
9. `prisma migrate dev` on a clean database applies `add_catalog_subdomain` as one file.
10. CI green: lint, typecheck, unit, integration, e2e, mobile. The mobile typecheck still compiles against the changed contract; T3 updates its use.

**Tests:**
- Shared unit: every `shared/catalog-subdomain.test.ts` title.
- `storefront-config.test.ts`.
- `catalog-settings.test.ts`.
- The subdomain-check title of `rate-limit.test.ts`.
- `catalog-settings-repository.integration.test.ts`.
- `api-routes.integration.test.ts` (section 14).

**Depends on:** nothing.

Note on the web typecheck: `catalogSettingsSchema` makes `url` nullable. `app/routes/catalog-settings.tsx` uses `settings.url` as a `string` (copy, input value, `href`), so web would fail to typecheck. T1 makes the minimal type adjustment there, rendering nothing new when `url` is null, with no UI change. It does the same in `store-appearance-settings.tsx` and `catalog-publication-card.tsx` if they read `url`. T2 then owns those files. The waves are sequential, so there is no file conflict.

Note on the mobile typecheck: T1 changes `catalogSettingsSchema`. If `apps/mobile` fails to typecheck against it, T1 makes the minimal type adjustment in `apps/mobile/src/features/catalog/infrastructure/catalog-settings-api.ts`, with `url` nullable and no UI change. T3 then owns that file.

### T2. Web seller UI

**Scope:**
- The web **Publicar catálogo** card with both groups and every status line state (product Screens table).
- The availability check:
  - invalid, reserved and current decided locally with the shared rules;
  - the 400 ms debounce comes before the `fetch`: no request is sent per keystroke. Then a latest-only `GET /api/catalog/subdomain-availability` goes through `catalog-link-client.ts`, with an `AbortController` per value. Aborting only stops the browser's wait; a sent request still counts against the per-user limit;
  - 429 and `no_response` shown as the check-failed state.
- Enter saves only when enabled and never submits the draft.
- The save through `catalog-link-client.ts` (`PUT /api/catalog/subdomain`), never through the editor action. The card keeps the returned settings, and nothing revalidates.
- Change confirmation with focus rules.
- `not_sent` versus `no_response` (including an answered `503`), and the doubt flow. The re-read is `GET /api/catalog/settings` through the same client, never a loader revalidation. Its failure keeps the editor, the draft and the typed value, with the in-doubt message and **Reintentar** (which resends the same `PUT`).
- «Tu link» with **Copiar link** and **Ver catálogo** while published.
- Switch disabled without a subdomain, with the accessible description.
- Unsaved-link tracking feeding the editor's leave confirmation with the three descriptions; `beforeunload` for reload and close.
- Accessibility: name, description, polite announcements of final verdicts only.
- Settings → Catálogo: label «Link de tu catálogo», wrapping selectable text, three states, **Ir a Apariencia de la tienda** to `settings/store-appearance#catalog-publication` (scroll, no focus).
- es and pt-BR texts.

**Out of scope:** API and backend (T1), mobile (T3), brand-host serving (T4).

**Acceptance criteria:** product acceptance criteria 3, 4, 5 (web side), 6 (message), 7, 8 (web), 9, 10, 11 and 12 on web. In particular:
1. Typing `Fantasio` shows `fantasio`. After the pause: «fantasio.localhost:3000 está disponible» in tests (`.yoyos.lat` in production), and **Guardar link** enabled.
2. Typing `pay` or the saved link shows its state with no request to the availability route.
3. `fantasio-store` typed quickly never shows the hyphen reason.
4. With a saved link, **Guardar link** on a new value opens «¿Cambiar el link de tu catálogo?». **Mantener link actual** keeps the typed value and returns focus to **Guardar link**.
5. Editing the link and clicking another menu entry shows «Tienes cambios sin guardar» / «Si sales ahora, no se guardará el link que escribiste.».
6. **Guardar cambios** with a pending link saves only logo and theme, and the link status line stays.
7. A successful **Guardar link** does not re-read the preview products.
8. With the network cut (browser offline mode, or a request blocked in Playwright or the test), the check and the re-read show their messages inside the card. The editor, the logo and theme draft and the typed link stay, and the editor's error boundary never appears (product AC 9).

**Tests:** the "Web seller UI" titles in section 14, and E2E `catalog-link.spec.ts`.

**Depends on:** T1.

### T3. Mobile seller UI

**Scope:** section 10 in full:
- the card, including local decisions for invalid, reserved and current, and the rate-limited check shown as failed;
- Settings → Catálogo;
- the leave guard descriptions;
- `focus=catalog` navigation;
- keyboard visibility;
- accessibility announcements;
- the Ajustes row text;
- translations.

**Out of scope:** core changes.

**Acceptance criteria:** product acceptance criteria 3, 4, 7, 8 (mobile, including Settings → Catálogo after returning to the screen), 9, 10, 11, 12 and 20 on mobile. In particular:
1. With the app pointed at a local core, saving `fantasio` shows «Link guardado» and «Tu link: http://fantasio.localhost:3000/», and enables the switch.
2. **Compartir** in Settings → Catálogo shares the brand URL.
3. **Ir a Apariencia de la tienda** opens **Editar** scrolled to the card with no keyboard.
4. Typing `pay` sends no availability request.

**Tests:** the mobile titles in section 14.

**Depends on:** T1.

### T4. Brand host serving, legacy redirect and cart

**Scope:**
- `classifyHost` (format only).
- `resolveStorefront` with the single-round-trip resolver, and the resolved store in context.
- `resolveLegacyCatalogLink`, with the 308 carrying `no-store`.
- `checkCartOrder` and `orders.readCatalogOrderConfirmation` (single statement).
- Hostname in the request context; root middleware (with `/carrito` passing through) and root `ErrorBoundary`; `StoreNotFound`.
- `catalog-layout.tsx` and the new `routes.ts` structure.
- Storefront pages on `/`, `/productos/:productId` and `/carrito`, with access and store from the host and links without the prefix.
- Cart action intents with per-intent limiters (`allowCatalogOrderCheck`).
- The `continued` flag; the order check once per document load and on `pageshow.persisted`; the full `checkoutUrl` navigation.
- Removal of the checkout clearing effect.
- Legacy redirect and legacy cart routes.
- The brand-host edge middleware (`/api`, `robots.txt`, scanner paths).
- The `storeHost` log field.
- E2E fixtures for `*.localhost`, and the buyer specs moved to the brand host.

**Out of scope:** seller UI (T2, T3), infra (founder), the `refreshCart` image N+1 (deferred).

**Acceptance criteria:** product acceptance criteria 1, 2, 13, 14, 15, 16, 17 and 19 against `http://<subdomain>.localhost:4173`. In particular:
1. `http://fantasio.localhost:4173/login` answers 404 with «No encontramos esta página» in Fantasio's theme. **Volver al catálogo** opens `/`.
2. `http://no-existe.localhost:4173/` and Fantasio's host after hiding both answer 404 «Catálogo no disponible» with the same body, which contains nothing company-specific.
3. With Fantasio hidden, an open cart's refresh answers `404 CATALOG_UNAVAILABLE` JSON, and **Continuar** and `check_order` answer `409 CATALOG_UNAVAILABLE` JSON.
4. A published store whose subdomain is then added to `reservedCatalogSubdomains` keeps serving.
5. `http://fantasio.localhost:4173/api/me` answers 404 `NOT_FOUND`. `/robots.txt` answers `Disallow: /`.
6. `http://127.0.0.1:4173/catalogo/<id>/productos/<pid>?x=1` answers 308 with `Cache-Control: no-store` to `http://fantasio.localhost:4173/productos/<pid>?x=1`.
7. After confirming on `127.0.0.1:4173/checkout/...`, returning to Fantasio's host shows the empty cart. The same products create a new order number.
8. A cart that was never continued sends no `check_order`. Twenty-one storefront page views with a continued cart do not make **Continuar** answer 429.
9. A published storefront request reads the store once (one resolver call, no `readStore`).
10. The store-appearance editor preview renders product cards with no link to `/catalogo/:id`.

**Tests:**
- Unit: `store-host.test.ts`, `resolve-storefront.test.ts`, `check-cart-order.test.ts`, the `check_order` title of `rate-limit.test.ts`, `storefront.test.ts`, `catalog-cart-storage.test.ts`, `catalog-cart.test.tsx`.
- Integration: the app edge titles, the orders confirmation title, and the route titles in section 14.
- E2E: `public-catalog.spec.ts` and `public-catalog-theme.spec.ts` on the brand host.

**Depends on:** T1.

### Merge preconditions

The final merge to `main` deploys to both Coolify apps from `compose.prod.yaml`. Before it:

1. `CATALOG_BASE_URL` is set to `https://yoyos.lat` in the production app and to `https://yoyos.kogozstaging.lat` in the staging app.
2. In each app, the stored value is checked in Coolify → Environment Variables. It must be the URL, not the placeholder `CATALOG_BASE_URL is required`.

Without them, the deploy runs the migration (every catalog becomes hidden) and then `web` crash-loops on startup. The whole app goes down, not just the catalog. Restoring it means setting the variable and redeploying; the migration is already applied and stays.

Infra steps 1–5 below are needed for brand hosts to work in production. The app runs without them: `app.yoyos.lat` is unaffected, and brand hosts do not resolve until step 4. They can be done before or right after the merge, and they must be done before the production verification.

### Infra (founder, manual)

No agent has Cloudflare or Coolify credentials. Decided by the review gate: Cloudflare Origin CA certificate and Full (strict). Steps in order:

1. **Origin certificate.**
   - Cloudflare → SSL/TLS → Origin Server → **Create certificate**: RSA, hostnames `*.yoyos.lat` and `yoyos.lat`, 15 years.
   - Save the certificate as `/data/coolify/proxy/certs/yoyos-origin.pem` and the key as `/data/coolify/proxy/certs/yoyos-origin.key` on the VPS (`chmod 600` on the key).
   - Coolify → Servers → `yoyos-prod-contabo` → Proxy → **Dynamic Configurations** → add `yoyos-origin.yaml`, then restart the proxy if Coolify asks:

     ```yaml
     tls:
       certificates:
         - certFile: /traefik/certs/yoyos-origin.pem
           keyFile: /traefik/certs/yoyos-origin.key
     ```

2. **Traefik routing with explicit labels.** Do not add `*.yoyos.lat` as a Coolify domain: Coolify would attach its Let's Encrypt `certresolver` (repeated failing HTTP-01 attempts for a wildcard) and generate a rule that may not match. Leave the `web` domain as `https://app.yoyos.lat`.

   **Where the labels go.** The `yoyos` application is a Docker Compose resource (`compose.prod.yaml`), and Coolify takes custom Traefik labels for such resources from the compose file. So T1 puts the labels on the `web` service in `compose.prod.yaml`, not in a Coolify UI field. They are versioned, survive redeploys, and reach staging too, where they are harmless (no `yoyos.lat` traffic arrives there). This step is therefore only the founder's verification.

   **The `$` in the regex.** In the compose file, the anchor is written `$$`, as the `migrate` command already writes `$$DATABASE_URL`. Compose interpolation turns it into a single `$`. A bare `$` would break interpolation and fail the whole deploy. T1 acceptance criterion 8 checks the rendered label.

   **The service.** The labels define their own Traefik service, `yoyos-stores`, on port 3000. The founder checks under **Show deployable compose** that every router Coolify generates for `web` carries its own `.service=` label, because Traefik refuses an unnamed service when a container defines two. If one does not, the `yoyos-stores` routers name Coolify's service instead (the `<name>` in `traefik.http.services.<name>.loadbalancer.server.port=3000`), and the `yoyos-stores` service label is dropped.

   1. Check the Traefik version under Servers → Proxy. Coolify v4 ships Traefik v3, and the v3 syntax is shown. For v2, use ``HostRegexp(`{subdomain:[a-z0-9-]+}.yoyos.lat`)``.
   2. Open **Show deployable compose** and check that the labels below appear on `web` with a single `$`, next to Coolify's own labels, and that Coolify's routers name their service.
   3. Cloudflare → Workers Routes: check that no route on the `yoyos.lat` zone matches `*yoyos.lat/*` or `*.yoyos.lat/*`, so the landing Worker never captures brand hosts.

   ```yaml
   # compose.prod.yaml, service web
   labels:
     - "traefik.http.routers.yoyos-stores.rule=HostRegexp(`^[a-z0-9-]+\\.yoyos\\.lat$$`)"
     - "traefik.http.routers.yoyos-stores.entrypoints=https"
     - "traefik.http.routers.yoyos-stores.tls=true"
     - "traefik.http.routers.yoyos-stores.priority=1"
     - "traefik.http.routers.yoyos-stores.service=yoyos-stores"
     - "traefik.http.routers.yoyos-stores-http.rule=HostRegexp(`^[a-z0-9-]+\\.yoyos\\.lat$$`)"
     - "traefik.http.routers.yoyos-stores-http.entrypoints=http"
     - "traefik.http.routers.yoyos-stores-http.priority=1"
     - "traefik.http.routers.yoyos-stores-http.middlewares=yoyos-stores-https"
     - "traefik.http.routers.yoyos-stores-http.service=yoyos-stores"
     - "traefik.http.middlewares.yoyos-stores-https.redirectscheme.scheme=https"
     - "traefik.http.middlewares.yoyos-stores-https.redirectscheme.permanent=true"
     - "traefik.http.services.yoyos-stores.loadbalancer.server.port=3000"
   ```

   - The low priority keeps the exact `app.yoyos.lat` rule first.
   - No `certresolver` goes on these routers: Traefik serves the origin certificate from step 1.
   - The HTTP router redirects plain HTTP that reaches the origin to HTTPS.
   - In a double-quoted YAML string, `\\.` is a regex `\.`.
3. **Environment.** See "Merge preconditions": `CATALOG_BASE_URL=https://yoyos.lat` (production) and `https://yoyos.kogozstaging.lat` (staging), checked in Coolify. Redeploy.
4. **Cloudflare DNS.** DNS → Records → **Add record**: type `A`, name `*`, IPv4 `94.72.118.64`, Proxy status **Proxied** (orange), TTL Auto. The explicit apex, `www` and `app` records keep precedence over the wildcard.
5. **Cloudflare HTTPS and SSL mode.**
   - SSL/TLS → Edge Certificates → **Always Use HTTPS**: On. It redirects every `http://` request at the edge, so typed addresses work before any request reaches the origin. The HTTP router from step 2 is the second line.
   - SSL/TLS → Overview → **Custom** → **Full (strict)**. The zone is on Automatic (running as Full). Switch only after the two origin `curl` checks in step 6 pass:
     - `app.yoyos.lat` keeps its Let's Encrypt certificate;
     - brand hosts get the origin certificate.

     If `app.yoyos.lat` fails under strict, go back to Full and report it.
   - **Let's Encrypt renewal of `app.yoyos.lat`.** Under Full (strict), `app.yoyos.lat` depends on its Let's Encrypt certificate renewing at the origin. Today that works through the Cloudflare proxy with HTTP-01 on Traefik's `http` entrypoint. A broken renewal shows up weeks later, as a 526 on the whole app host, not at deploy time. Right after turning on **Always Use HTTPS**, check:

     ```sh
     curl -sSI http://app.yoyos.lat/.well-known/acme-challenge/x | grep -iE '^(HTTP|location)'
     ```

     - A 404 with no `location` means the challenge path reaches the origin over HTTP, so renewal keeps working.
     - A 301 or 308 to `https://` means the edge redirects the challenge. Roll back: turn **Always Use HTTPS** off (the step-2 HTTP router still redirects brand hosts at the origin), keep Full, and report it. The fallback is then to serve `app.yoyos.lat` with the step-1 origin certificate as well (it covers `*.yoyos.lat`), removing the Let's Encrypt dependency. That is a founder decision, so it is not done here.
   - **Rollback for the whole step:** SSL/TLS → Overview → back to Full, and **Always Use HTTPS** off. Both take effect within seconds and need no deploy.
   - Check that the redirect rules for the apex (`yoyos.lat` → `app.yoyos.lat` for core paths) and for `www` match exact hostnames (`http.host eq "yoyos.lat"`), not the wildcard.
6. **Verify:**

   ```sh
   dig +short fantasio.yoyos.lat                        # Cloudflare IPs (not the VPS IP)
   curl -sSI http://no-existe.yoyos.lat/ | grep -iE '^(HTTP|location)'                            # 301/308, location https://no-existe.yoyos.lat/
   curl -sSI http://app.yoyos.lat/.well-known/acme-challenge/x | grep -iE '^(HTTP|location)'      # 404, no location (Let's Encrypt renewal path)
   curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://no-existe.yoyos.lat/   # 404 0
   curl -sS https://no-existe.yoyos.lat/ | grep -c 'Catálogo no disponible'                       # 1
   curl -sSI https://<published>.yoyos.lat/ | grep -iE '^(HTTP|referrer-policy)'                 # 200, no-referrer
   curl -sS https://<published>.yoyos.lat/ | grep -c 'noindex'                                   # 1
   curl -sS -o /dev/null -w '%{http_code}\n' https://<published>.yoyos.lat/api/me                # 404
   curl -sS https://<published>.yoyos.lat/robots.txt                                             # Disallow: /
   curl -sSI https://app.yoyos.lat/catalogo/<company id> | grep -iE '^(HTTP|location|cache-control)'  # 308, https://<published>.yoyos.lat/, no-store
   curl -sSI https://yoyos.lat/ | head -1                                                         # landing unchanged
   curl -sSI https://www.yoyos.lat/ | grep -i '^location'                                         # still to the apex
   # Origin answers the wildcard with the origin certificate (validated against Cloudflare's Origin CA root):
   curl -sS --resolve fantasio.yoyos.lat:443:94.72.118.64 --cacert origin_ca_rsa_root.pem \
     -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://fantasio.yoyos.lat/            # 404 or 200, 0
   # The app host keeps a publicly trusted certificate at the origin (required by Full strict):
   curl -sS --resolve app.yoyos.lat:443:94.72.118.64 -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.yoyos.lat/health   # 200 0
   # Plain HTTP at the origin redirects:
   curl -sSI --resolve fantasio.yoyos.lat:80:94.72.118.64 http://fantasio.yoyos.lat/ | grep -iE '^(HTTP|location)'   # 301/308 to https
   ```

   `origin_ca_rsa_root.pem` is Cloudflare's published Origin CA RSA root. Until a catalog is published, use any free name: it must answer «Catálogo no disponible».

### Final verification

- The manual checks in section 14 on a phone after the infra steps and the deploy:
  - brand host over HTTPS without warnings, and from a typed `http://` address;
  - the bfcache back button in Safari iOS;
  - the mobile keyboard and screen reader behavior.
- The `curl` checks above.
- Results go in the pull request description. The coordinator then promotes the documentation (`docs/public-catalog.md`, `docs/checkout.md`, the `CATALOG_BASE_URL` and infra procedure next to `BETTER_AUTH_URL`) and deletes both drafts.

## 17. Questions decided by the review gate

The founder confirms these in the final pull request.

1. **Origin authentication between Cloudflare and Coolify's Traefik for `*.yoyos.lat`.**
   - **Answer:** a Cloudflare Origin CA certificate for `*.yoyos.lat` and `yoyos.lat`, installed in Traefik, with SSL mode Full (strict).
   - **Decided by:** the design and performance reviewers of the architecture gate, round 1.
   - **Reason:** Cloudflare keeps verifying the origin for every host. No DNS-editing token lives on the server. There is no renewal job or ACME failure mode that could take every brand host down at once.
   - **Conditions applied in section 16:**
     - an HTTP→HTTPS path (Always Use HTTPS plus an HTTP router);
     - routing through explicit labels;
     - switching to strict only after the origin checks pass.
   - **Discarded:**
     - Full (not strict) with Traefik's self-signed certificate: it stops verifying the origin for the hosts buyers use;
     - a Let's Encrypt wildcard through DNS-01 with a Cloudflare token on the VPS: it puts a DNS credential on the app server and adds renewal failure modes.
2. **Staging `CATALOG_BASE_URL`.**
   - **Answer:** `https://yoyos.kogozstaging.lat`, with no working brand hosts on staging. The variable stays required, with no default.
   - **Decided by:** the design and performance reviewers of the architecture gate, round 1.
   - **Reason:**
     - `{sub}.yoyos.kogozstaging.lat` is two levels deep, so Universal SSL does not cover it, and `*.kogozstaging.lat` points to another host;
     - E2E already covers the brand-host paths on `*.localhost`;
     - the base equals the staging app host, so copied links stay inside staging;
     - a default would let a deploy that forgot the variable publish wrong links.
   - **Discarded:** Advanced Certificate Manager for `*.yoyos.kogozstaging.lat`, which adds a monthly cost and a second manual procedure for flows already tested.

### Decided unless objected

- The subdomain is a nullable unique column `Company.catalogSubdomain`. A `CHECK` on `Company` makes a published catalog without a subdomain impossible.
- The migration (`BEGIN`/`COMMIT`, `lock_timeout` 5 s, nothing else in it) hides every published catalog and assigns no subdomain.
- The reserved list lives only in code (`shared/catalog-subdomain.ts`) and applies only when choosing a name. The format is also a database `CHECK`.
- One `SECURITY DEFINER` function, `resolve_catalog_subdomain`, returns owner, publication, name and country in one round trip, following `resolve_buyer_order_company`. The `Company` RLS policy is unchanged.
- The resolved store travels in the request context. Storefront requests do not call `readStore` again.
- One variable, `CATALOG_BASE_URL`, per environment: production `https://yoyos.lat`, staging `https://yoyos.kogozstaging.lat`, dev `http://localhost:<port>`, E2E `http://localhost:4173`. Required in production. Setting it in both Coolify apps is a merge precondition. A shell guard in the `migrate` command fails the deploy before the schema changes when the value is missing or the Coolify placeholder. Dev and tests use `*.localhost`.
- `classifyHost` judges format only. A one-label, well-formed host under the base, other than the app host, is a store host, reserved or not. Malformed labels and deeper names render «Catálogo no disponible».
- `/carrito` is never blocked by the middleware. On a hidden, released or unknown host it answers today's JSON `CATALOG_UNAVAILABLE`, and so does `check_order`.
- On brand hosts:
  - `/api/*` answers 404;
  - `/robots.txt` answers `Disallow: /`;
  - common scanner paths answer a plain 404 before React Router.

  Session cookies stay host-only on `app.yoyos.lat`.
- The legacy `/catalogo/:id` and its product pages answer 308 with the query kept and `Cache-Control: no-store`. The product is not checked. The legacy cart route keeps the catalog-turned-off outcome.
- The cart is emptied through `POST /carrito` `check_order`:
  - only when the cart's current order id was sent to **Continuar**;
  - once per document load and on `pageshow.persisted`;
  - through a single-statement confirmation read;
  - outside the **Continuar** rate limit, with its own per-IP limit (120 per 10 minutes, adjustable).

  The checkout no longer touches the cart. Order id and number never reach brand-host logs.
- **Continuar** navigates to the full checkout URL on the app host.
- The availability check is a separate read-only endpoint. It does one lookup and has a per-user limit (60 per minute, adjustable), and its 429 shows the check-failed state. Clients never call it for values the shared rules decide. The save endpoint is idempotent for the same value. Business rejections answer 422 and a lost race 409. Errors use the repository envelope `{ code, error, issues? }` through `apiError`. The format reason travels as `issues: [{ field: "subdomain", reason }]`. The new codes are added to `apiErrorCodeSchema`, and `catalogSettingsErrorSchema` parses that envelope on both clients. Core computes the suggestion; the editor loader pays one suggestion probe only while no link is saved.
- The web link group calls the JSON API with plain `fetch` through `app/lib/catalog-link-client.ts`, for the check, the save and the in-doubt re-read (`GET /api/catalog/settings`). It never uses a route loader, action, fetcher or revalidation, so network failures stay inside the card. The client returns `not_sent` (`navigator.onLine === false`), `no_response` (rejection, timeout, `5xx` or a bad body) or `answered`. A `503` on a save is treated as no answer and re-read on web and mobile. On mobile, "not sent" is `expo-network` `isConnected === false` before sending; every other transport failure is no answer. The availability debounce comes before the `fetch`. `set-publication` keeps its action and skips revalidation. Mobile uses the same API and shared schemas.
- The settings response changes shape. Old mobile builds stop reading it (accepted by the product).
- Logs never include the subdomain value, the `Host` header, the order id or the order number.
- Deferred: the `refreshCart` image N+1, as a follow-up outside this work.
- Deferred, with real risk: per-IP limiters keyed on Cloudflare's edge address behind the current `trust proxy`. This predates the design, and the fix is app-wide. Recommended before catalog traffic is real.
- The resolver is uncached. `/__manifest` passes the storefront middleware without a lookup. The two new limiters log their warn only for the first rejection per key per window.
- `add_catalog_subdomain` stays one file with explicit `BEGIN`/`COMMIT`, deliberately.
- Plan: T1, then T2, T3 and T4 in parallel. The `yoyos-stores` Traefik labels go in `compose.prod.yaml` (T1), with `$$` for the anchor. The Cloudflare and certificate steps and the label checks stay manual for the founder. The coordinator runs the documentation promotion after the final verification.
