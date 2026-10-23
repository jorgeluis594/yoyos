# Public catalog by brand subdomain: technical design

**Status:** draft with open questions. Based on [`docs/drafts/catalog-subdomain.md`](catalog-subdomain.md) (product definition approved by the review gate in round 3). Base: `jorgeluis594/refactor-del-catalogo-publico-por-subdom` at `d74395e5`.

## 1. Technical goal

Each company stores one catalog subdomain. Core recognizes a request to `https://{subdomain}.{catalog base domain}/` by its host, resolves the company that owns that subdomain, and serves only that company's published catalog there: the grid at `/`, the product page at `/productos/:productId`, and the cart resource route at `/carrito`. Any other path on a brand host renders the store's themed «No encontramos esta página», or «Catálogo no disponible» when there is no published store. Sellers check and save the subdomain from the **Publicar catálogo** card (web and mobile). Publishing requires a saved subdomain, and the database enforces that rule. The legacy `/catalogo/:companyId` links redirect to the brand address. The checkout stays on the app host. The brand-host cart learns that its order was confirmed by asking core.

```text
Buyer browser ── https://fantasio.yoyos.lat/… ──▶ Cloudflare (proxied *.yoyos.lat, Universal SSL)
                                                    │  Host: fantasio.yoyos.lat
                                                    ▼
                                         VPS · Coolify Traefik (HostRegexp *.yoyos.lat, origin cert)
                                                    ▼
                         core Express: req.hostname ─▶ classifyHost ─▶ app | store(subdomain) | invalid
                                │                                   │
                       /api/* on a store host → 404           React Router root middleware
                                                                    │ resolve_catalog_subdomain_company(subdomain)
                                                                    │ readStore(companyId) (published?)
                                                                    ▼
                               storefront routes (/, /productos/:id, /carrito) with access { companyId }
                                                                    │ Continuar → checkoutUrl on app host
                                                                    ▼
                                          https://app.yoyos.lat/checkout/:companyId/:orderId (unchanged)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Where the subdomain is stored | A nullable `Company.catalogSubdomain` column with a unique index, next to the existing `Company.catalogPublished`. The subdomain is an attribute of the company's catalog and has no identity of its own, so it gets no table. |
| "Published requires a subdomain" | A `CHECK (NOT "catalogPublished" OR "catalogSubdomain" IS NOT NULL)` on `Company`. Publishing is a conditional update that also requires the subdomain, and the constraint is the backstop. A published catalog without a subdomain cannot be stored. |
| Deploy-time hiding | The same migration sets `catalogPublished = false` on every row before it adds the constraint. Every company starts without a subdomain, so every catalog becomes hidden atomically with the deploy. No company gets a subdomain automatically. |
| Format | A `CHECK` on `catalogSubdomain` (`^[a-z0-9]+(-[a-z0-9]+)*$`, 3–30 characters) backs the pure parser. The reserved list lives only in code, so adding a name never touches stored data. |
| Cross-company lookups | One `SECURITY DEFINER` function, `resolve_catalog_subdomain_company(subdomain text) RETURNS uuid`, follows the existing `resolve_buyer_order_company` pattern. It answers who owns a subdomain, for the brand-host resolution and the availability check. Every other read and write stays under the `Company` RLS policy. |
| Uniqueness race | The unique index on `catalogSubdomain` decides it. `UPDATE "Company" SET "catalogSubdomain" = $1 WHERE id = $company` raises `23505`, which the adapter translates to `SUBDOMAIN_TAKEN`. A failed update assigns nothing and keeps the previous value. The single statement replaces the old value and releases it in the same commit. |
| Base domain per environment | One server variable, `CATALOG_BASE_URL` (scheme, host and optional port, with no path). Production: `https://yoyos.lat`. Docker dev: `http://localhost:${WEB_PORT}`. E2E: `http://localhost:4173`. The store URL is `{protocol}//{subdomain}.{host}/`. The visible suffix is `.{host}` (`.yoyos.lat`, or `.localhost:3000` in dev). Production fails at startup without it; other environments fall back to `http://localhost:3000`, the same as `BETTER_AUTH_URL`. Initial value, adjustable. |
| Simulated hosts in dev and tests | `*.localhost` resolves to loopback in Chromium, Firefox and curl, so `http://fantasio.localhost:3000/` works locally with no DNS. E2E launches Chromium with `--host-resolver-rules=MAP *.localhost 127.0.0.1`, so the result is deterministic. Route and middleware tests build `Request`s with any `Host`. |
| Which host is a store host | `classifyHost(hostname)`: a hostname of exactly one DNS label plus the base hostname is a store host (`fantasio.yoyos.lat`), unless it equals the app hostname (`new URL(BETTER_AUTH_URL).hostname`). Every other hostname is the app host (`app.yoyos.lat`, `127.0.0.1`, `localhost`, the base apex). A store label that fails the format or is reserved is classified as `invalid` and renders «Catálogo no disponible». The port is ignored. |
| Host source | Express `req.hostname` (Express 5, `trust proxy` = `loopback, uniquelocal`, so it honours Traefik's `X-Forwarded-Host`). It reaches React Router through `createRequestContext(req.ip, req.hostname)` in a new `requestHostContext`. Outside Express (route tests), the middleware falls back to `new URL(request.url).hostname`. |
| Routing on the brand host | React Router keeps one route config. A root middleware, `storefrontMiddleware`, resolves the store for store hosts and throws a 404 for any path outside the storefront paths (`/`, `/productos/:productId`, `/carrito`). A new root `ErrorBoundary` renders the themed «No encontramos esta página» or «Catálogo no disponible» from the thrown data. The storefront routes sit under a pathless layout, `catalog-layout.tsx`, whose middleware handles the app host: `/` keeps today's 308 to `/es-PE/`, and the other storefront paths answer the generic 404. |
| API on the brand host | Express answers `404 {"code":"NOT_FOUND"}` to every `/api/*` request on a store or invalid host, before Better Auth and the routers. A brand host never signs anyone in and never serves seller data. |
| Session cookies | Better Auth cookies stay host-only on the app host. No cookie `Domain` and no `crossSubDomainCookies`, so brand hosts never receive a seller session. |
| Legacy links | `/catalogo/:companyId` and `/catalogo/:companyId/productos/:productId` become redirect-only routes. They answer 308 to the brand URL with the query kept when the company has a subdomain and the catalog is published, and «Catálogo no disponible» (404) otherwise. `/catalogo/:companyId/carrito` keeps answering the catalog-turned-off outcome (`GET` 404, `POST` 409 `CATALOG_UNAVAILABLE`), so an open legacy tab gets today's outcome. |
| Continuar target | The cart sheet navigates to the full `checkoutUrl` (app host). Today it keeps only the pathname. `checkoutUrl` keeps being built from `BETTER_AUTH_URL`. |
| Cart after confirming | The storefront asks core whether the stored cart's order is confirmed: `POST /carrito` with `{ intent: "check_order", orderId }` answers `{ order: "confirmed" \| "not_confirmed" }`. The browser empties the cart on `confirmed`. It asks when a storefront page mounts with a non-empty cart, and on `pageshow` with `persisted` (back button from the checkout restored from bfcache). The checkout's `clearCartForOrder` effect is removed, because the catalog no longer shares its origin. |
| Cart key | `yoyos.catalog-cart.${companyId}` stays. The storefront loader returns the resolved `companyId`, so a released subdomain taken by another company reads another key and shows an empty cart. |
| Availability answer | `available`, `current`, `in_use`, `reserved` or `invalid` (with the reason). It is answered only to an authenticated seller with a company. It never says which company holds a name. |
| Suggestion | Computed by core in the settings read (`suggestion`), only when the company has no subdomain and the derived value is valid, not reserved and free at that moment. Clients never derive it. |
| Format rules shared by web and mobile | `shared/catalog-subdomain.ts`: `parseCatalogSubdomain`, `reservedCatalogSubdomains`, `suggestCatalogSubdomain`. Core's domain, the web card and the mobile card use them, so the instant state (help text, reason after the pause) never disagrees with the server. Core still validates every save. |
| Web transport | Web keeps its loader and action pattern. The save is a `save-subdomain` intent of the «Apariencia de la tienda» action. The check is a resource route, `settings/catalog/subdomain-availability`, loaded with a fetcher. Mobile uses the JSON API. Both call the same composed operations. |
| Old mobile builds | The settings response changes shape (`url` becomes nullable, new fields), so builds older than this version fail to read it. The product accepts this (decision 19). No compatibility field is kept. |
| Out of this design | Custom domains, subdomain history or redirects, a cooling period for released names, moving the cart between hosts, moving the checkout, and measuring visits. All are listed in the product draft. |
| Deferred item with real risk | Reuse of a released subdomain by another company, and cached legacy 308s pointing to the old subdomain. Flagged by the product draft. No Todoist task exists; the founder decides whether to create one. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Publication flag | `Company.catalogPublished` (`apps/core/prisma/schema.prisma:89`, migration `20261017050645_add_public_catalog`) | Reused. Gains the `CHECK` with the subdomain. |
| Settings use cases | `apps/core/src/features/catalog/application/catalog-settings.ts` (`getCatalogSettings`, `setCatalogPublication`) | Modified: subdomain, suggestion, and the publish rule. |
| Settings repository | `apps/core/src/features/catalog/infrastructure/catalog-settings-repository.ts` (`readPublished`, `savePublished`) | Replaced by `readCatalogSettings` and `savePublication`, plus `saveSubdomain` and `findSubdomainOwner`. |
| Settings composition | `apps/core/src/features/catalog/composition.ts` (`catalogSettings.get`, `.setPublication`, logs `catalog_publication_changed`) | Extended with `.checkSubdomain` and `.saveSubdomain`. |
| Settings response | `apps/core/src/features/catalog/presentation/settings-response.ts` (`catalogUrl` = `BETTER_AUTH_URL` + `/catalogo/:id`) | Rewritten around `storeUrl(subdomain)`. |
| Settings API | `apps/core/src/features/catalog/presentation/api-routes.ts` (`GET`/`PUT /api/catalog/settings`), mounted at `apps/core/src/app.ts:101` | Extended with availability and subdomain routes. |
| Contract | `shared/contracts/catalog.ts` (`catalogSettingsSchema {published, url}`, `setCatalogPublicationSchema`) | Changed (section 8). |
| Store read | `apps/core/src/features/catalog/infrastructure/catalog-store-repository.ts:12` `readStore` (null when unpublished or unknown) | Reused as is. It keeps protecting every storefront read. |
| Browse and cart compositions | `apps/core/src/features/catalog/browse-composition.ts` (`catalogBrowse`), `cart-composition.ts` (`catalogCart`); access `{ companyId }` from the URL | Reused. Access now comes from the host. `catalogCart.checkOrder` is added. |
| Catalog order creation | `apps/core/src/features/orders/application/create-catalog-order.ts` (same id returns the existing catalog order) | Unchanged. |
| Checkout confirmation | `orders.confirmCheckoutDelivery`, `apps/core/app/routes/checkout.tsx:122`; cart clearing effect at `checkout.tsx:198` | Effect removed. The checkout itself is unchanged. |
| Buyer order resolver | Migration `20261005064406_resolve_buyer_order_access` (`resolve_buyer_order_company`, `SECURITY DEFINER`) | Pattern reused for `resolve_catalog_subdomain_company`. |
| Web routes | `apps/core/app/routes.ts:4,13-15` (`index` → `legacy-redirect.ts`; `catalogo/:companyId`, `…/productos/:productId`, `…/carrito`; `*` → `not-found.tsx`) | Restructured (section 12). |
| Catalog pages | `apps/core/app/routes/catalog.tsx`, `catalog-product.tsx`, `catalog-cart.tsx`; `apps/core/app/components/catalog-sections.tsx` (`catalogHeaders`, `catalogMeta`, `CatalogShell`, `CatalogMessage`, `CatalogLoadError`), `catalog-cart.tsx` (component), `apps/core/app/lib/catalog-cart-storage.ts` | Moved to the storefront paths. Links lose the `/catalogo/:id` prefix. |
| Root | `apps/core/app/root.tsx` (`middleware = [i18nextMiddleware]`, no `ErrorBoundary`) | Gains `storefrontMiddleware` and an `ErrorBoundary`. |
| Request context | `apps/core/app/entry.server.tsx:19` `createRequestContext(clientIp)`, `apps/core/src/server.ts:14-16` | Extended with the hostname. |
| Express app | `apps/core/src/app.ts` (`trust proxy` `loopback, uniquelocal`; no Host handling, no CORS, no cookie domain) | Gains the store-host API guard. |
| Seller web card | `apps/core/app/components/catalog-publication-card.tsx:20`, route `apps/core/app/routes/store-appearance-settings.tsx` (`readPublication` :47, `set-publication` :78), `store-appearance-editor-actions.ts` | Extended with the link group. |
| Seller web Settings → Catálogo | `apps/core/app/routes/catalog-settings.tsx` (uses `settings.url`) | Shows the brand link as wrapping text. |
| Mobile catalog feature | `apps/mobile/src/features/catalog/` (`infrastructure/catalog-settings-api.ts`, `presentation/catalog-publication-card.tsx`, `catalog-settings-screen.tsx`, `translations.ts`, `composition.ts`); screen `apps/mobile/src/features/store-appearance/presentation/store-appearance-screen.tsx` (publication slot :45) | Extended. |
| Env | `BETTER_AUTH_URL` read directly from `process.env` (no Zod env module); `compose.yaml:61`, `compose.prod.yaml:41`, `apps/core/.env.example`, `apps/core/scripts/run-tests.sh:51` (e2e app URL `http://127.0.0.1:4173`) | `CATALOG_BASE_URL` added next to it. |
| E2E | `apps/core/tests/e2e/public-catalog.spec.ts`, `public-catalog-theme.spec.ts`, `store-appearance-buyer.spec.ts`; `fixtures.ts:6` (baseURL `127.0.0.1:4173`) | Moved to the brand host. |
| Cloudflare | Apex = landing Worker; proxied `A www` and `A app` → 94.72.118.64; 308 rule apex → `app.yoyos.lat` for core paths; Universal SSL covers `*.yoyos.lat` (verified by the coordinator on 2026-10-22); no `*` record (NXDOMAIN) | Wildcard record to be added by the founder (section 16, Infra). |
| Coolify | `compose.prod.yaml` `web` (`expose 3000`); Traefik routes by the domains configured in Coolify | Wildcard routing and origin certificate to be added by the founder. |
| Assumption | The React Router Express adapter builds `request.url` from `Host`/`X-Forwarded-Host`; the design does not depend on it, because the host comes from `req.hostname`. `node_modules` was not installed in this worktree to confirm the adapter. | Verified during implementation (section 15). |

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
10. The infrastructure does not route `*.yoyos.lat` to core (section 16, Infra).

## 5. Use cases

All of them belong to `apps/core/src/features/catalog` unless stated. `CompanyId` and `UserId` are the existing brands. Each dependency returns `Result`. Valid absence is `ok(null)`.

### 5.1 `getCatalogSettings` (modified)

- **input:** none. **access:** `CatalogSettingsAccess { companyId, userId }`.
- **deps:**
  - `readCatalogSettings(companyId): Promise<Result<{ published: boolean; subdomain: CatalogSubdomain | null; companyName: string }, CatalogSettingsError>>`
  - `findSubdomainOwner(subdomain): Promise<Result<CompanyId | null, CatalogSettingsError>>`
- **output:** `CatalogSettings = { published: boolean; subdomain: CatalogSubdomain | null; suggestion: CatalogSubdomain | null }`.
- **errors:** `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA` (stored subdomain fails the parser).
- **flow:**
  1. Read the settings.
  2. If there is a subdomain, return it with `suggestion: null`.
  3. Otherwise derive `suggestCatalogSubdomain(companyName)`. If it returns a value that is not reserved, look up its owner.
  4. The suggestion is the value when there is no owner, and `null` when the value is taken, reserved, too short, or the lookup failed. A failed lookup never fails the read: it logs and drops the suggestion.

### 5.2 `checkSubdomainAvailability` (new)

- **input:** `{ value: string }` (raw text, at most 200 characters at the boundary). **access:** `CatalogSettingsAccess`.
- **deps:** `readCatalogSettings`, `findSubdomainOwner`.
- **output:** `SubdomainAvailability`:
  - `{ status: "available"; subdomain }`
  - `{ status: "current"; subdomain }`
  - `{ status: "in_use"; subdomain }`
  - `{ status: "reserved" }`
  - `{ status: "invalid"; reason: SubdomainFormatReason }`
- **errors:** `PERSISTENCE_UNAVAILABLE`.
- **flow:**
  1. Lowercase the value and run `parseCatalogSubdomain`. An invalid value returns `invalid`.
  2. If it equals the stored subdomain, return `current`. This comes before the reserved check, so a name added to the list later never takes away a saved subdomain.
  3. A reserved value returns `reserved`.
  4. Look up the owner: none means `available`, the same company means `current`, and another company means `in_use`.
- Read-only; it writes nothing.

### 5.3 `saveCatalogSubdomain` (new)

- **input:** `{ subdomain: string }`. **access:** `CatalogSettingsAccess`.
- **deps:**
  - `readCatalogSettings`
  - `saveSubdomain(companyId, subdomain): Promise<Result<null, SaveSubdomainError>>`. It fails with `SUBDOMAIN_TAKEN` on the unique violation.
- **output:** `CatalogSettings` (after the save) plus `change: "unchanged" | "first" | "replaced"`.
- **errors:** `INVALID_SUBDOMAIN` (with `reason`), `SUBDOMAIN_RESERVED`, `SUBDOMAIN_TAKEN`, `PERSISTENCE_UNAVAILABLE`.
- **flow:**
  1. Parse the subdomain. Values under 3 characters fail with `too_short`; the server never lowercases for the client.
  2. Read the current settings. If the value equals the current subdomain, return `unchanged`, with no write. This makes a retry after a lost response safe.
  3. A reserved value fails with `SUBDOMAIN_RESERVED`.
  4. `saveSubdomain` runs one scoped `UPDATE … WHERE id = companyId`. The unique index decides a race; a taken value fails with `SUBDOMAIN_TAKEN` and leaves the stored value as it was.
  5. Return the settings with `change: "first"` when there was no previous subdomain, otherwise `"replaced"`.
- The confirmation before replacing a subdomain is a client rule. The server does not ask for a flag, because the product requires the save to work the same whatever the client.

### 5.4 `setCatalogPublication` (modified)

- **input:** `{ published: boolean }`. **access:** `CatalogSettingsAccess`.
- **deps:**
  - `savePublication(companyId, published): Promise<Result<"saved" | "subdomain_missing", CatalogSettingsError>>`. To publish, it runs `UPDATE "Company" SET "catalogPublished" = true WHERE id = $1 AND "catalogSubdomain" IS NOT NULL` and returns `subdomain_missing` when no row matches. To hide, it updates without the condition.
  - `readCatalogSettings`, `findSubdomainOwner` (to return the settings, through 5.1).
- **output:** `CatalogSettings`.
- **errors:** `SUBDOMAIN_REQUIRED`, `PERSISTENCE_UNAVAILABLE`.
- Hiding is always allowed. Repeating the same value is idempotent, as today.

### 5.5 `resolveStorefront` (new)

- **input:** `{ host: StoreHost }`, the output of `classifyHost`. **access:** none (public, by host).
- **deps:**
  - `findSubdomainOwner`
  - `readStore(companyId)`, the existing function. It is null when the catalog is unpublished.
- **output:** `Storefront | null`, where `Storefront = { companyId; subdomain; store: CatalogStore }`.
- **errors:** `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA`.
- **flow:**
  1. A host of kind `invalid` returns null.
  2. A host of kind `store` looks up the owner of its subdomain. No owner returns null.
  3. `readStore` runs under `withTenantIsolation(owner)`. An unpublished catalog returns null.
  4. Otherwise return the storefront.
- One answer (null) covers an unknown name, a released name, a reserved name, a malformed host and a hidden catalog, so the response never reveals whether a company exists.

### 5.6 `resolveLegacyCatalogLink` (new)

- **input:** `{ companyId: string }`, validated as a UUID at the boundary. **access:** none.
- **deps:** `readCatalogSettings` under `withTenantIsolation(companyId)`. Under RLS, an unknown company reads as absent.
- **output:** `{ kind: "redirect"; subdomain } | { kind: "unavailable" }`.
- **flow:** published with a subdomain gives `redirect`; anything else gives `unavailable`. Presentation builds the URL with the product path and the query.

### 5.7 `checkCartOrder` (new)

- **input:** `{ orderId: OrderId }`. **access:** `CatalogAccess { companyId }`, from the resolved storefront.
- **deps:** `readCatalogOrderConfirmation(companyId, orderId): Promise<Result<"confirmed" | "not_confirmed", …>>`. This is a new capability of `orders/composition.ts`. A catalog order of that company with `checkoutConfirmedAt` set is `confirmed`; a missing order, a pending one, a non-catalog one, or one of another company (invisible under RLS) is `not_confirmed`.
- **output:** `"confirmed" | "not_confirmed"`.
- **errors:** `PERSISTENCE_UNAVAILABLE`.
- It does not check publication: the answer only tells the browser to empty its own cart.

### 5.8 Existing ones that change only their access source

`browseCatalog`, `getCatalogProduct`, `catalogCart.refresh` and `continueToCheckout` keep their signatures. Their `access.companyId` comes from `storefrontContext` instead of the URL parameter. Each one still calls `readStore`, so a catalog hidden between the middleware and the loader answers «Catálogo no disponible».

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

`parseCatalogSubdomain` receives the value already lowercased. The input lowercases as the seller types; core lowercases in `checkSubdomainAvailability`, and the save rejects uppercase as `invalid_character`. A leading hyphen reports `hyphen_edge` even with one or two characters, because `hyphen_edge` comes before `too_short`.

### 6.2 Host classification (`apps/core/src/features/catalog/domain/store-host.ts`)

```ts
export type StoreHost =
  | Readonly<{ kind: "app" }>
  | Readonly<{ kind: "store"; subdomain: CatalogSubdomain }>
  | Readonly<{ kind: "invalid" }>;          // one label under the base, but malformed or reserved
export type HostConfig = Readonly<{ baseHostname: string; appHostname: string }>;
export function classifyHost(hostname: string, config: HostConfig): StoreHost;
```

It lowercases the hostname, strips a trailing dot, and ignores the port. `app` covers the app hostname and everything not under the base (IPs, `localhost`, the base apex). A deeper name (`a.b.yoyos.lat`) is `invalid`. A reserved label (`www`, `api`) is `invalid`.

### 6.3 Storefront config (`apps/core/src/features/catalog/infrastructure/storefront-config.ts`)

```ts
export type StorefrontConfig = Readonly<{ baseUrl: URL; host: HostConfig }>;
export function parseStorefrontConfig(env: Readonly<{ CATALOG_BASE_URL?: string; BETTER_AUTH_URL?: string; NODE_ENV?: string }>): Result<StorefrontConfig, { code: "INVALID_CONFIG"; message: string }>;
export const storefrontConfig: StorefrontConfig; // parsed once at import; throws at startup on INVALID_CONFIG
export function storeUrl(subdomain: CatalogSubdomain, path?: string): URL; // `${protocol}//${subdomain}.${host}${path ?? "/"}`
export function storeDomain(): string; // baseUrl.host, e.g. "yoyos.lat" or "localhost:3000"
```

The Zod schema requires `http:` or `https:`, a hostname that is not an IP, and no path, query or hash. `https:` is required when `NODE_ENV=production`. The variable is required in production.

### 6.4 Authority per layer

| Layer | Types and authority |
| --- | --- |
| `shared/catalog-subdomain.ts` | Format, reasons, reserved list, suggestion. Pure. |
| Core catalog domain | `StoreHost`, `classifyHost`. |
| Core catalog application | Availability, save, publication rule, storefront resolution, legacy link, cart order check. |
| Core infrastructure | Unique index, `CHECK`s, the `SECURITY DEFINER` lookup, error translation. |
| Web and mobile | Instant format state, debounce, latest-answer-only, change confirmation, unsaved-link tracking. Never authoritative. |

New types and why they exist:
- `CatalogSubdomain`: a value with rules.
- `SubdomainAvailability`: five distinct outcomes the UI renders.
- `StoreHost`: a three-way classification instead of nullable pairs.
- `Storefront`: the resolved store, which carries the company for access.
- `StorefrontConfig`: per-environment values.

`CatalogSettings` gains fields. `CatalogSettingsAccess`, `CatalogAccess` and `CatalogStore` are reused.

## 7. Persistence

Migration name: `add_catalog_subdomain`, generated with `prisma migrate dev --create-only` and edited following the database-migrations skill.

```prisma
model Company {
  catalogPublished Boolean @default(false)
  catalogSubdomain String? @unique
  // …
}
```

Edited SQL in one short transaction. `Company` has one row per business, so the locks are brief:

```sql
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Company" ADD COLUMN "catalogSubdomain" TEXT;
-- Deploy-time rule: no catalog stays published without a subdomain.
UPDATE "Company" SET "catalogPublished" = false WHERE "catalogPublished";
ALTER TABLE "Company" ADD CONSTRAINT "Company_catalogSubdomain_format_check"
  CHECK ("catalogSubdomain" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("catalogSubdomain") BETWEEN 3 AND 30);
ALTER TABLE "Company" ADD CONSTRAINT "Company_catalogPublished_requires_subdomain_check"
  CHECK (NOT "catalogPublished" OR "catalogSubdomain" IS NOT NULL);
CREATE UNIQUE INDEX "Company_catalogSubdomain_key" ON "Company"("catalogSubdomain");

CREATE FUNCTION public.resolve_catalog_subdomain_company(subdomain text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT id FROM public."Company" WHERE "catalogSubdomain" = subdomain
$$;
REVOKE ALL ON FUNCTION public.resolve_catalog_subdomain_company(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_catalog_subdomain_company(text) TO core_app;
```

- The RLS policy on `Company` is unchanged. Reads and writes of the company's own settings use `prisma` under `withTenantIsolation(companyId)`.
- `findSubdomainOwner` calls the function through `systemPrisma.$queryRaw` with a parameter, and validates the row with Zod (`z.uuid().nullable()`).
- Translation: Prisma `P2002` (or `23505`) on `catalogSubdomain` becomes `SUBDOMAIN_TAKEN`. `23514` on `Company_catalogPublished_requires_subdomain_check` becomes `SUBDOMAIN_REQUIRED`; this is the backstop, and it is not expected given the conditional update. Other failures become `PERSISTENCE_UNAVAILABLE`.
- Stored rows are read with a Zod row schema (`catalogSubdomain` through `parseCatalogSubdomain`). A stored value that fails it is `INVALID_STORED_DATA`.
- Development data: nothing is deleted. Published catalogs become hidden, as the product requires (there are no customers, guide 6.9).
- Fixtures and tests that set `catalogPublished: true` must also set `catalogSubdomain`. Those listed in section 3 are updated in T1.
- `apps/core/src/features/orders/infrastructure/public-catalog-migration.integration.test.ts` checks the old migration's default and stays as is. No new migration test is written (Testing skill).

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
export const catalogSettingsErrorSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("INVALID_SUBDOMAIN"), reason: subdomainFormatReasonSchema }),
  z.strictObject({ code: z.enum(["SUBDOMAIN_RESERVED", "SUBDOMAIN_TAKEN", "SUBDOMAIN_REQUIRED", "INVALID_CATALOG_SETTINGS", "SERVICE_UNAVAILABLE"]) }),
]);
```

| Route | Success | Errors |
| --- | --- | --- |
| `GET /api/catalog/settings` | 200 `catalogSettingsSchema` | 503 `SERVICE_UNAVAILABLE` |
| `PUT /api/catalog/settings` `{ published }` | 200 settings | 400 `INVALID_CATALOG_SETTINGS`, 409 `SUBDOMAIN_REQUIRED`, 415, 503 |
| `GET /api/catalog/subdomain-availability?value=` | 200 `subdomainAvailabilitySchema` (also for `invalid` and `reserved`: a verdict, not an error) | 400 `INVALID_CATALOG_SETTINGS` (missing or over 200 characters), 503 |
| `PUT /api/catalog/subdomain` `{ subdomain }` | 200 settings (same value: 200, no change) | 400 `INVALID_SUBDOMAIN` + `reason`, 422 `SUBDOMAIN_RESERVED`, 409 `SUBDOMAIN_TAKEN`, 400 `INVALID_CATALOG_SETTINGS` (bad body), 415, 503 |

- Every route requires the seller session or bearer token with a company (the existing `requireApiCompany`), and answers `Cache-Control: no-store`.
- Core validates its responses against the schemas before sending them. Mobile validates every response and error body with them.
- The legacy `url` meaning (`/catalogo/:id`) is gone.
- Storefront resource route on the brand host (`/carrito`, React Router action, not `/api`) is web-only. Its schemas live in `features/catalog/presentation/cart-schemas.ts`:
  - `{ intent: "continue", orderId, lines }`: today's body plus the `intent`.
  - `{ intent: "check_order", orderId }`: answers `{ order: "confirmed" | "not_confirmed" }`.
  - `GET ?v=` refresh: unchanged.

## 9. Events and cross-feature integration

No domain event. Cross-feature capabilities:

| Capability | Owner | Consumer | Shape |
| --- | --- | --- | --- |
| `orders.readCatalogOrderConfirmation(companyId, orderId)` | `orders/composition.ts` | `catalog/cart-composition.ts` (`checkCartOrder`) | `Promise<Result<"confirmed" \| "not_confirmed", { code: "PERSISTENCE_UNAVAILABLE" }>>`, under `withTenantIsolation(companyId)` |
| `orders.checkoutUrl(companyId, orderId)` | orders (existing) | catalog cart (existing) | unchanged; the client now uses the whole URL |
| `catalogStorefront.resolve(host)` | catalog | root middleware (`app/middleware/storefront.ts`) | `Promise<Result<Storefront \| null, …>>` |
| `catalogLegacy.resolve(companyId)` | catalog | `app/routes/legacy-catalog-redirect.ts` | section 5.6 |
| Store appearance read (`catalogBrowse.storeAppearance`) | catalog (existing, using store-appearance) | root `ErrorBoundary` data for the themed not-found page | existing |

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| The buyer confirms, then the order check fails (offline, 503) | The cart keeps its lines. **Continuar** reopens the confirmed order's checkout, which shows it as confirmed. | Accepted by the product. Nothing is duplicated or lost. |
| The buyer confirms in another browser | Same as above. | Accepted by the product. |
| Back button from the checkout restores a bfcache page | `pageshow.persisted` triggers the check. | Empty cart once the answer arrives. |
| The seller changes the subdomain while a buyer has the page open | The next request resolves the host again. A free old name gives «Catálogo no disponible» or `CATALOG_UNAVAILABLE`; a name taken by another company gives that company's store, and the lines show as no longer available. | As the product defines. |

## 10. Mobile

| File | Change |
| --- | --- |
| `src/features/catalog/domain/` (new `catalog-link.ts`) | Screen model `CatalogLink = { published; subdomain \| null; url \| null; domain; suggestion \| null }`. `linkFieldState(value, verdict)` (pure) maps the typed value plus the latest verdict to the status line state of the product table, reusing `parseCatalogSubdomain`. |
| `src/features/catalog/infrastructure/catalog-settings-api.ts` | `get()` and `setPublished()` parse the new schema. New `checkSubdomain(value)` and `saveSubdomain(subdomain)`. Error bodies are parsed with `catalogSettingsErrorSchema` into `{ code, reason? }`. A request without an answer is `{ kind: "no_response" }`; a failure before sending is `{ kind: "not_sent" }`. |
| `src/features/catalog/composition.ts` | Exposes the two new operations. |
| `src/features/catalog/presentation/hooks/use-catalog-link.ts` (new) | 400 ms debounce (initial value, adjustable). Drops the verdict on every edit. An `AbortController` and a request counter keep only the latest answer. After a save without an answer, it re-reads the settings and decides saved, not saved, or in doubt. It reports `hasUnsavedLink` (edited and different from the initial value). |
| `src/features/catalog/presentation/catalog-publication-card.tsx` | Two groups: the link (field with suffix `.{domain}`, status line, **Guardar link**, «Tu link», **Copiar link** and **Ver catálogo** while published) and the publication (switch disabled without a subdomain). Change confirmation with **Cambiar link** in destructive style. `autoCapitalize="none"`, `autoCorrect={false}`, `keyboardType="url"`, `returnKeyLabel`/`returnKeyType` set to «Guardar». Final verdicts announced with `AccessibilityInfo.announceForAccessibility`. |
| `src/features/catalog/presentation/catalog-settings-screen.tsx` | Selectable, wrapping `Text` for the URL. «Link de tu catálogo» label. Three states (published, hidden with a subdomain, hidden without one). **Ir a Apariencia de la tienda** pushes `/settings/appearance?focus=catalog`. Keeps re-reading on focus. |
| `src/features/catalog/presentation/translations.ts` | New es and pt-BR texts. |
| `src/features/store-appearance/presentation/store-appearance-screen.tsx` | The publication slot receives `onUnsavedLinkChange`. The leave guard combines the draft with `hasUnsavedLink` and picks one of the three descriptions. `focus=catalog` opens **Editar** scrolled to the card without focusing the field. The scroll view keeps the field, the status line and **Guardar link** above the keyboard and the save bar (`KeyboardAvoidingView` or `scrollToFocusedInput`, following the screen's current pattern). |
| `src/app/(tabs)/settings/appearance.tsx`, `src/app/(tabs)/settings/index.tsx` | Pass the `focus` parameter. Row description «Logo, tema, link y publicación de tu catálogo». |

No local SQLite data. No sync queue.

| Situation | Decision |
| --- | --- |
| Availability request fails | «No pudimos revisar si está disponible.» with **Reintentar**. **Guardar link** stays enabled. |
| Save not sent | «No pudimos guardar tu link. Revisa tu conexión.» with **Reintentar**. |
| Save without an answer | Re-read once. Saved, not saved, or a failed re-read follow the product table. **Reintentar** resends the same `PUT`, which is idempotent. |
| `SUBDOMAIN_REQUIRED` on publish | The switch goes back to off with «Elige el link de tu catálogo para poder publicarlo.». |

## 11. Transactions and concurrency

1. **Save subdomain.**
   - `withTenantIsolation(companyId)` reads the current value, then one `prisma.company.update({ where: { id }, data: { catalogSubdomain } })`.
   - No explicit lock. The unique index serializes two companies saving the same value: exactly one commits, and the other gets `23505` → `SUBDOMAIN_TAKEN`.
   - Two saves by the same company: the last one wins. Each one releases its own previous value in its commit.
   - The read before the update only decides `unchanged` and `first`/`replaced` for the response. If a parallel save by the same company changes it in between, the outcome is still a consistent stored value.
2. **Publish.**
   - One conditional `UPDATE … WHERE id = $1 AND "catalogSubdomain" IS NOT NULL`, with the `CHECK` as the backstop.
   - A subdomain cannot be removed, so no race can leave a published catalog without one.
3. **Storefront resolution.**
   - Two independent reads (owner, then `readStore` under the owner's context), each in its own short transaction, as all tenant reads are.
   - A change between them gives the "open page on a changed address" outcome defined by the product.
4. **Continuar.** Unchanged (existing transaction, same id returns the same order).

Duplicate policy:
- A repeated save of the same value is a success with no write.
- A repeated publish is idempotent.
- Repeated **Continuar** uses today's id rule.
- Repeated order checks are reads.

## 12. Code organization

### Core: catalog feature

| File | Change |
| --- | --- |
| `domain/store-host.ts` (+ test) | `StoreHost`, `classifyHost`. |
| `application/catalog-settings.ts` (+ test) | `getCatalogSettings` (modified), `setCatalogPublication` (modified), `checkSubdomainAvailability`, `saveCatalogSubdomain` (new, in the same file because they share access, deps and errors). |
| `application/resolve-storefront.ts` (+ test) | `resolveStorefront`, `resolveLegacyCatalogLink`. |
| `application/check-cart-order.ts` (+ test) | `checkCartOrder`. |
| `infrastructure/catalog-settings-repository.ts` (+ integration test) | `readCatalogSettings`, `savePublication`, `saveSubdomain`, `findSubdomainOwner`. Replaces `readPublished` and `savePublished`. |
| `infrastructure/storefront-config.ts` (+ test) | Section 6.3. |
| `presentation/settings-response.ts` | `toCatalogSettingsResponse(settings)` using `storeUrl` and `storeDomain`. `catalogUrl` is removed. |
| `presentation/api-routes.ts` (+ integration test) | New availability and subdomain routes; the `SUBDOMAIN_REQUIRED` mapping. |
| `presentation/cart-schemas.ts` | `intent`-discriminated action body. |
| `composition.ts` | `catalogSettings.{get, setPublication, checkSubdomain, saveSubdomain}`; new `catalogStorefront.resolve`, `catalogLegacy.resolve`. |
| `cart-composition.ts` | `catalogCart.checkOrder`. |
| `index.ts` | Exports what `app/` and `app.ts` consume (`catalogStorefront`, `catalogLegacy`, `classifyHost`, `storefrontConfig`). |

### Core: orders feature

| File | Change |
| --- | --- |
| `composition.ts` | `readCatalogOrderConfirmation(companyId, orderId)`, reusing the checkout order read (`findCheckoutOrder`) inside `withTenantIsolation`. |

### Core: app entry and web

| File | Change |
| --- | --- |
| `src/app.ts` | After `/health` and before `/api/auth`: `storeHostApiGuard`. `/api/*` on a non-`app` host answers 404 `{ code: "NOT_FOUND" }`. |
| `src/server.ts`, `app/entry.server.tsx` | `createRequestContext(req.ip, req.hostname)`. |
| `app/request-host-context.ts` (new) | `requestHostContext = createContext<string \| null>(null)`. |
| `app/storefront-context.ts` (new) | `storefrontContext = createContext<StorefrontAccess \| null>(null)` with `{ companyId }`. |
| `app/middleware/storefront.ts` (+ test) | Root middleware, after `i18nextMiddleware`. Steps: classify, resolve, then set the context or throw. `isStorefrontPath(pathname)` is the closed list. It throws `data({ kind: "catalog_unavailable" }, 404)`, `data({ kind: "store_not_found", header }, 404)` with the store name and appearance, or `data({ kind: "catalog_load_error" }, 503)`. |
| `app/root.tsx` | `middleware = [i18nextMiddleware, storefrontMiddleware]`. `ErrorBoundary` renders the three storefront kinds with `catalog-sections` components, and otherwise the generic error as today. |
| `app/routes.ts` | `index("routes/legacy-redirect.ts")` is replaced by `layout("routes/catalog-layout.tsx", [index("routes/catalog.tsx"), route("productos/:productId", "routes/catalog-product.tsx"), route("carrito", "routes/catalog-cart.tsx")])`. `catalogo/:companyId` and `catalogo/:companyId/productos/:productId` → `routes/legacy-catalog-redirect.ts`; `catalogo/:companyId/carrito` → `routes/legacy-catalog-cart.ts`. A new web resource route, `settings/catalog/subdomain-availability` → `routes/catalog-subdomain-availability.ts` (T1). |
| `app/routes/catalog-layout.tsx` (new) | Middleware for the app host: `/` → 308 `/es-PE/` with the query (today's `legacy-redirect.ts` loader, which is deleted); other storefront paths → 404 generic not-found. Renders `<Outlet/>` on the store host. |
| `app/routes/catalog.tsx`, `catalog-product.tsx`, `catalog-cart.tsx` | Read `storefrontContext` instead of `params.companyId`. Product links `/productos/:id`. **Volver al catálogo** → `/`. The cart action dispatches by `intent`. Headers and `noindex` kept. |
| `app/routes/legacy-catalog-redirect.ts`, `legacy-catalog-cart.ts` (new) | Section 5.6, and the catalog-turned-off outcome for the cart. |
| `app/routes/catalog-subdomain-availability.ts` (new, T1) | Seller loader (session, company) → `catalogSettings.checkSubdomain`, JSON `subdomainAvailabilitySchema`, `no-store`. |
| `app/components/catalog-sections.tsx` | New `StoreNotFound` (header, «No encontramos esta página», «Revisa el link o mira los productos de la tienda.», **Volver al catálogo**). |
| `app/components/catalog-cart.tsx` | Route `/carrito`. `window.location.assign(body.checkoutUrl)`. The order check on mount and on `pageshow.persisted` when the cart has lines. |
| `app/lib/catalog-cart-storage.ts` | `clearCartForOrder` kept (now called by the storefront when the check says `confirmed`). |
| `app/routes/checkout.tsx` | The `clearCartForOrder` effect is removed. |
| `app/components/catalog-publication-card.tsx`, `app/routes/store-appearance-settings.tsx`, `app/components/store-appearance-editor-actions.ts`, `app/routes/catalog-settings.tsx`, web locales | Seller UI (T2): link group, `save-subdomain` intent, change confirmation, unsaved-link leave descriptions, Settings → Catálogo text and states, scroll to card (`#catalog-publication`). |

### Config and infrastructure files

| File | Change |
| --- | --- |
| `compose.yaml` (`web`) | `CATALOG_BASE_URL: ${CATALOG_BASE_URL:-http://localhost:${WEB_PORT:-3000}}`. |
| `compose.prod.yaml` (`web`) | `CATALOG_BASE_URL: ${CATALOG_BASE_URL:?CATALOG_BASE_URL is required}`. Coolify sets `https://yoyos.lat`. The worker does not need it. |
| `apps/core/.env.example` | `CATALOG_BASE_URL=http://localhost:3000`, with a comment: brand hosts open at `http://<subdomain>.localhost:3000/`. |
| `apps/core/scripts/run-tests.sh` | `CATALOG_BASE_URL=http://localhost:${CORE_E2E_PORT:-4173}` for e2e; `http://localhost:3000` otherwise. |
| `apps/core/tests/e2e/fixtures.ts` | Chromium launch arg `--host-resolver-rules=MAP *.localhost 127.0.0.1`; helper `storeUrl(subdomain, path)`; helper `publishCatalog(companyId, subdomain)` (direct, for buyer specs). |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `catalog_subdomain_saved` | info | catalog composition, after commit | `["companyId", "userId", "change"]` (`first` \| `replaced`; `unchanged` does not log) |
| `catalog_subdomain_rejected` | debug | catalog composition | `["companyId", "userId", "errorCode", "reason"]` |
| `unable_to_save_catalog_subdomain` | error | settings repository | `["companyId", "errorCode", "err"]` |
| `catalog_publication_changed` | info | catalog composition (existing) | `["companyId", "userId", "published"]` |
| `catalog_publication_rejected` | debug | catalog composition | `["companyId", "userId", "errorCode"]` (`SUBDOMAIN_REQUIRED`) |
| `unable_to_read_catalog` | error | settings repository (existing event) | `["companyId", "operation", "errorCode", "err"]`, with `operation`: `read_settings`, `find_subdomain_owner` |
| `catalog_subdomain_suggestion_unavailable` | warn | `getCatalogSettings` composition | `["companyId", "errorCode"]` |
| `unable_to_resolve_storefront` | error | storefront middleware | `["stage", "errorCode", "err"]`, `stage`: `find_owner` \| `read_store` |
| `unable_to_check_cart_order` | error | orders composition | `["companyId", "errorCode", "err"]` |
| `http_request_completed` | info | existing request logging | new `operation` values: `get_catalog_settings`, `check_catalog_subdomain`, `save_catalog_subdomain`, `set_catalog_publication`, `resolve_storefront`, `legacy_catalog_link`, `check_cart_order`; `outcome`; plus `storeHost: "app" \| "store" \| "invalid"` |

- Never logged: the typed or saved subdomain, which can be a person's name; the `Host` header and the request URL of a brand host; `orderId`, a checkout credential; and cart contents.
- Resolution failures for unknown hosts are not logged: they are expected and come from anyone.
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
- `test("classifies the app hostname, IPs, localhost and the base apex as the app host")`
- `test("classifies www.yoyos.lat, a.b.yoyos.lat and a malformed label as invalid")`
- `test("ignores the port and a trailing dot and lowercases the hostname")`

`apps/core/src/features/catalog/infrastructure/storefront-config.test.ts`:
- `test("builds https://fantasio.yoyos.lat/ and the .yoyos.lat suffix from https://yoyos.lat")`
- `test("keeps the port in dev: http://fantasio.localhost:3000/")`
- `test("rejects a base URL with a path, an IP host, or http in production")`
- `test("requires CATALOG_BASE_URL in production")`

`apps/core/src/features/catalog/application/catalog-settings.test.ts`:
- `test("returns the available suggestion when the company has no subdomain")`
- `test("returns no suggestion when it is taken, reserved, too short or its lookup fails")`
- `test("answers current for the saved subdomain even after it became reserved")`
- `test("answers in_use without revealing which company holds the name")`
- `test("saving the current subdomain succeeds without writing")`
- `test("rejects saving a reserved, invalid or too short subdomain and writes nothing")`
- `test("reports SUBDOMAIN_TAKEN and keeps the previous subdomain when the save loses the race")`
- `test("reports first for the first subdomain and replaced for a change")`
- `test("rejects publishing without a saved subdomain with SUBDOMAIN_REQUIRED")`
- `test("hides the catalog with or without a subdomain")`

`apps/core/src/features/catalog/application/resolve-storefront.test.ts`:
- `test("resolves the published store whose subdomain matches the host")`
- `test("returns the same null for an unknown, released, reserved, malformed or hidden host")`
- `test("redirects a legacy link only when the company has a subdomain and a published catalog")`

`apps/core/src/features/catalog/application/check-cart-order.test.ts`:
- `test("answers confirmed for a confirmed catalog order of the store")`
- `test("answers not_confirmed for a pending, missing or other company order")`

`apps/core/app/middleware/storefront.test.ts`:
- `test("serves only /, /productos/:productId and /carrito on a store host")`
- `test("throws store_not_found with the store header for /login on a published store host")`
- `test("throws catalog_unavailable for any path on an unknown or hidden store host")`
- `test("leaves app host requests untouched")`

`apps/core/app/lib/catalog-cart-storage.test.ts`:
- `test("clears the cart when the storefront learns its order was confirmed and keeps another order's cart")`

### Core integration

`apps/core/src/features/catalog/infrastructure/catalog-settings-repository.integration.test.ts`:
- `test("two companies saving fantasio at the same time: exactly one keeps it, the other gets SUBDOMAIN_TAKEN")`
- `test("changing the subdomain releases the previous one for another company in the same commit")`
- `test("the database rejects a published catalog without a subdomain")`
- `test("the database rejects a subdomain outside the format")`
- `test("finds the owner of a subdomain across companies without exposing other company rows")`
- `test("a company cannot update another company's subdomain")`

`apps/core/src/features/catalog/presentation/api-routes.integration.test.ts`:
- `test("settings API returns subdomain, brand url, domain and suggestion")`
- `test("availability API answers available, current, in_use, reserved and invalid with reason")`
- `test("subdomain API saves, repeats the same value as success, and maps reserved, invalid and taken")`
- `test("publishing without a subdomain answers 409 SUBDOMAIN_REQUIRED and keeps the catalog hidden")`
- `test("catalog settings routes reject requests without a session")`

`apps/core/src/app.integration.test.ts` (or the existing app route test file):
- `test("any /api path on a store host answers 404 without reaching auth or routers")`

`apps/core/app/routes/catalog.test.ts` and `catalog-cart.test.ts` (route modules with a controlled `Host`):
- `test("the grid on fantasio.localhost shows Fantasio products and sends noindex and no-referrer")`
- `test("a product of another company on Fantasio's host shows the product no longer available with 404")`
- `test("Continuar on Fantasio's host with another company's variants creates no order")`
- `test("check_order answers confirmed only for this store's confirmed order")`
- `test("Continuar answers the full checkout URL on the app host")`
- `test("legacy /catalogo/:id/productos/:pid?x=1 redirects 308 to the brand product URL with the query")`
- `test("legacy /catalogo/:id shows Catálogo no disponible when hidden or without subdomain")`
- `test("legacy cart POST answers CATALOG_UNAVAILABLE")`
- `test("/ on the app host keeps redirecting to /es-PE/ and /productos/:id answers the generic 404")`

`apps/core/src/features/catalog/browse-catalog.integration.test.ts`, `continue-to-checkout.integration.test.ts`: existing titles kept, with fixtures that set the subdomain.

### Mobile (Jest + RNTL)

`apps/mobile/src/features/catalog/domain/catalog-link.test.ts`:
- `test("maps every product status line state from the typed value and the latest verdict")`

`apps/mobile/src/features/catalog/infrastructure/catalog-settings-api.test.ts`:
- `test("parses settings, availability and subdomain errors with the shared contract")`
- `test("distinguishes a save not sent from a save without an answer")`

`apps/mobile/src/features/catalog/presentation/catalog-publication-card.test.tsx`:
- `test("prefills the available suggestion and keeps the switch disabled until the link is saved")`
- `test("shows only the verdict for the latest value after the pause and never announces Revisando")`
- `test("lowercases Fantasio while typing and keeps a 40 character paste whole with its reason")`
- `test("asks before replacing a saved link and saves nothing on Mantener link actual")`
- `test("shows Alguien acaba de tomar after an available verdict and the plain in-use text after a failed check")`
- `test("a save without an answer re-reads and shows Link guardado or Tu link no se guardó")`
- `test("the return key saves only when Guardar link is enabled")`

`apps/mobile/src/features/catalog/presentation/catalog-settings-screen.test.tsx`:
- `test("shows the full brand link with Copiar link, Compartir and Ver catálogo while published")`
- `test("shows the hidden texts with and without a subdomain and no link to share")`

`apps/mobile/src/features/store-appearance/presentation/store-appearance-screen.test.tsx`:
- `test("leaving with an edited link asks with the link description and an untouched suggestion asks nothing")`

### Web E2E (happy path only)

- `apps/core/tests/e2e/public-catalog.spec.ts`: `test("buyer opens fantasio's brand host, adds two variants, continues to the app checkout, confirms and finds an empty cart back in the store")`
- `apps/core/tests/e2e/catalog-link.spec.ts`: `test("seller chooses fantasio in Apariencia de la tienda, saves it, publishes and copies https://fantasio.localhost:4173/ from Settings → Catálogo")`
- `apps/core/tests/e2e/public-catalog-theme.spec.ts`: the existing titles, run on the brand host.

### Pending manual checks

- After the infra steps: `https://<test>.yoyos.lat/` over HTTPS with no certificate warning on a phone (Chrome Android, Safari iOS) and in the Instagram in-app browser.
- Back button from the confirmed checkout to the store in Safari iOS (bfcache) shows an empty cart.
- Mobile on a physical device: the status line and **Guardar link** stay visible above the keyboard, the return key reads «Guardar», and TalkBack and VoiceOver announce only final verdicts.
- `curl` checks in section 16 (Infra) after the deploy.

## 15. Limits and checks during implementation

- Confirm that React Router 7.9 runs root middleware for `.data` and `__manifest` requests with the pathname normalized (no `.data` suffix) before `isStorefrontPath` is applied. If `__manifest` (lazy route discovery) reaches the middleware, it is allowed on store hosts.
- Confirm that a root `ErrorBoundary` without a `Layout` export renders a complete document in this app (`root.tsx` renders `<html>` in `App`). If not, add a `Layout` export so the boundary keeps head, scripts and the fixed color scheme of themed pages.
- Confirm that `req.hostname` behind Coolify's Traefik is the brand host (`X-Forwarded-Host`). A container-level smoke test after the deploy: `curl -H 'Host: fantasio.yoyos.lat' http://127.0.0.1:3000/` inside the container.
- `*.localhost` resolution in Chromium is native. The `--host-resolver-rules` flag removes the dependency on IPv6 `::1` versus `127.0.0.1`.
- Physical-device mobile dev against a LAN IP cannot open `*.localhost`. A developer who needs it sets `CATALOG_BASE_URL=http://<ip>.nip.io:3000`. This is documentation only, not code.
- Static assets (`/assets/*`, fonts, favicon) are served by `express.static` before the middleware on every host, which the brand pages need.
- The store-appearance preview iframe stays on the app host and renders catalog components without links. Verify that its product cards do not link to `/catalogo/:id`.
- Left out on purpose: custom domains, subdomain history, a cooling period, moving the cart between hosts, and visit metrics (product draft).
- Universal SSL covers only one level (`*.yoyos.lat`). The format forbids dots, so deeper names never become brand hosts.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T1 Backend settings, contract, schema and config
Wave 2:  T2 Web seller UI   ║  T3 Mobile seller UI  ║  T4 Brand host serving, legacy redirect and cart
                     (all three depend only on T1, and touch disjoint files)
Wave 3:  T5 Documentation promotion and full journey check
Infra (founder, manual): any time; required before the production verification
```

File ownership in wave 2:
- **T2:** `apps/core/app/components/catalog-publication-card.tsx`, `store-appearance-editor*.tsx`, `store-appearance-editor-actions.ts`, `app/routes/store-appearance-settings.tsx`, `app/routes/catalog-settings.tsx`, web locale files, `tests/e2e/catalog-link.spec.ts`.
- **T3:** only `apps/mobile/**`.
- **T4:** `apps/core/src/app.ts`, `src/server.ts`, `app/entry.server.tsx`, `app/root.tsx`, `app/routes.ts`, `app/middleware/storefront.ts`, `app/routes/catalog*.tsx` (grid, product, cart, layout), `app/routes/legacy-*.ts`, `app/routes/checkout.tsx`, `app/components/catalog-sections.tsx`, `app/components/catalog-cart.tsx`, `app/lib/catalog-cart-storage.ts`, `src/features/catalog/{browse,cart}-composition.ts`, `src/features/catalog/application/{resolve-storefront,check-cart-order}.ts`, `src/features/catalog/domain/store-host.ts`, `src/features/orders/composition.ts`, `tests/e2e/public-catalog*.spec.ts`, `tests/e2e/store-appearance-buyer.spec.ts`, `tests/e2e/fixtures.ts`.

### T1. Backend settings, contract, schema and config

**Scope:**
- Migration `add_catalog_subdomain` (section 7) and `schema.prisma`.
- `shared/catalog-subdomain.ts` and the new `shared/contracts/catalog.ts`.
- Use cases 5.1–5.4.
- Repository (section 12).
- `storefront-config.ts`, with `storeUrl` and `storeDomain`.
- `toCatalogSettingsResponse`.
- JSON API routes and their error mapping.
- Composition (`catalogSettings.checkSubdomain`, `.saveSubdomain`) and logs.
- The web resource route `settings/catalog/subdomain-availability` with its `routes.ts` entry.
- `CATALOG_BASE_URL` in `compose.yaml`, `compose.prod.yaml`, `.env.example` and `run-tests.sh`.
- Existing fixtures and specs that set `catalogPublished: true` now also set a subdomain. This includes `public-catalog-theme.spec.ts:15` and `store-appearance/presentation/api-routes.integration.test.ts`.
- `public-catalog.spec.ts` seeds the subdomain through the database before the seller publishes, so CI stays green while the catalog is still served at `/catalogo/:id`.
- The web «Apariencia de la tienda» publish action maps `SUBDOMAIN_REQUIRED` to the existing failed-save outcome. The new message is added by T2.

**Out of scope:** seller UI, brand-host serving, legacy redirect, cart check, docs.

**Acceptance criteria:**
1. `GET /api/catalog/settings` for «Café Fantasío» without a subdomain answers `{ published: false, subdomain: null, url: null, domain: "localhost:3000", suggestion: "cafe-fantasio" }`. If another company holds `cafe-fantasio`, `suggestion` is `null`.
2. `GET /api/catalog/subdomain-availability?value=pay` answers `{ status: "reserved" }`. `value=fa` answers `invalid`/`too_short`. `value=fantasio-` answers `invalid`/`hyphen_edge`. A name of another company answers `in_use`. A free name answers `available`.
3. `PUT /api/catalog/subdomain` with `pay`, `fa`, `-fantasio`, `fan--tasio` or `café` answers 422/400, and the company keeps no subdomain. With `fantasio` it answers 200 and `url: "http://fantasio.localhost:3000/"`. Repeating it answers 200 without logging `catalog_subdomain_saved`.
4. Two concurrent `PUT`s of `fantasio` from two companies: one gets 200 and the other gets 409 `SUBDOMAIN_TAKEN` and keeps its previous value.
5. `PUT /api/catalog/settings { published: true }` without a subdomain answers 409 `SUBDOMAIN_REQUIRED`. After saving a subdomain it answers 200 `published: true`.
6. After the migration, a company that was published is hidden, and no company has a subdomain.
7. Core starts with `NODE_ENV=production` only when `CATALOG_BASE_URL` is a valid `https` URL.
8. CI green: lint, typecheck, unit, integration, e2e, mobile (the mobile typecheck still compiles against the changed contract; T3 updates its use).

**Tests:**
- Shared unit: every `shared/catalog-subdomain.test.ts` title.
- `storefront-config.test.ts`.
- `catalog-settings.test.ts`.
- `catalog-settings-repository.integration.test.ts`.
- `api-routes.integration.test.ts` (section 14).

**Depends on:** nothing.

Note on the mobile typecheck: T1 changes `catalogSettingsSchema`. If `apps/mobile` fails to typecheck against it, T1 makes the minimal type adjustment in `apps/mobile/src/features/catalog/infrastructure/catalog-settings-api.ts`, with `url` nullable and no UI change. T3 then owns that file.

### T2. Web seller UI

**Scope:**
- The web **Publicar catálogo** card with both groups and every status line state (product Screens table).
- Debounce of 400 ms; a latest-only fetcher on `settings/catalog/subdomain-availability`.
- Enter saves only when enabled and never submits the draft.
- The `save-subdomain` intent in the editor action.
- Change confirmation with focus rules.
- The doubt flow (re-read through the route's revalidation).
- «Tu link» with **Copiar link** and **Ver catálogo** while published.
- Switch disabled without a subdomain, with the accessible description.
- Unsaved-link tracking feeding the editor's leave confirmation with the three descriptions; `beforeunload` for reload and close.
- Accessibility: name, description, polite announcements of final verdicts only.
- Settings → Catálogo: label «Link de tu catálogo», wrapping selectable text, three states, **Ir a Apariencia de la tienda** to `settings/store-appearance#catalog-publication` (scroll, no focus).
- es and pt-BR texts.

**Out of scope:** API and backend (T1), mobile (T3), brand-host serving (T4).

**Acceptance criteria:** product acceptance criteria 3, 4, 5 (web side), 6 (message), 7, 8 (web), 9, 10, 11 and 12 on web. In particular:
1. Typing `Fantasio` shows `fantasio`. After the pause: «fantasio.localhost:3000 está disponible» in tests (`.yoyos.lat` in production), and **Guardar link** enabled.
2. `fantasio-store` typed quickly never shows the hyphen reason.
3. With a saved link, **Guardar link** on a new value opens «¿Cambiar el link de tu catálogo?». **Mantener link actual** keeps the typed value and returns focus to **Guardar link**.
4. Editing the link and clicking another menu entry shows «Tienes cambios sin guardar» / «Si sales ahora, no se guardará el link que escribiste.».
5. **Guardar cambios** with a pending link saves only logo and theme, and the link status line stays.

**Tests:**
- `store-appearance-editor.test.tsx` and `catalog-settings.test.tsx` titles: one per behavior above (link states, confirmation, doubt flow, leave descriptions, Settings states).
- E2E `catalog-link.spec.ts`.

**Depends on:** T1.

### T3. Mobile seller UI

**Scope:** section 10 in full. The card, Settings → Catálogo, the leave guard descriptions, `focus=catalog` navigation, keyboard visibility, accessibility announcements, the Ajustes row text, translations.

**Out of scope:** core changes.

**Acceptance criteria:** product acceptance criteria 3, 4, 7, 8 (mobile, including Settings → Catálogo after returning to the screen), 9, 10, 11, 12 and 20 on mobile. In particular:
1. With the app pointed at a local core, saving `fantasio` shows «Link guardado» and «Tu link: http://fantasio.localhost:3000/», and enables the switch.
2. **Compartir** in Settings → Catálogo shares the brand URL.
3. **Ir a Apariencia de la tienda** opens **Editar** scrolled to the card with no keyboard.

**Tests:** the mobile titles in section 14.

**Depends on:** T1.

### T4. Brand host serving, legacy redirect and cart

**Scope:**
- `classifyHost`, `resolveStorefront`, `resolveLegacyCatalogLink`, `checkCartOrder` and `orders.readCatalogOrderConfirmation`.
- Hostname in the request context; root middleware and root `ErrorBoundary`; `StoreNotFound`.
- `catalog-layout.tsx` and the new `routes.ts` structure.
- Storefront pages on `/`, `/productos/:productId` and `/carrito`, with access from the host and links without the prefix.
- Cart action intents, the full `checkoutUrl` navigation, and the order check on mount and on `pageshow`.
- Removal of the checkout clearing effect.
- Legacy redirect and legacy cart routes.
- The `/api` guard on store hosts.
- E2E fixtures for `*.localhost`.
- The buyer specs moved to the brand host.

**Out of scope:** seller UI (T2, T3), infra (founder), docs (T5).

**Acceptance criteria:** product acceptance criteria 1, 2, 13, 14, 15, 16, 17 and 19 against `http://<subdomain>.localhost:4173`. In particular:
1. `http://fantasio.localhost:4173/login` answers 404 with «No encontramos esta página» in Fantasio's theme. **Volver al catálogo** opens `/`.
2. `http://no-existe.localhost:4173/` and Fantasio's host after hiding both answer 404 «Catálogo no disponible» with the same body, which contains nothing company-specific.
3. `http://fantasio.localhost:4173/api/me` answers 404 `NOT_FOUND`.
4. `http://127.0.0.1:4173/catalogo/<id>/productos/<pid>?x=1` answers 308 to `http://fantasio.localhost:4173/productos/<pid>?x=1`.
5. After confirming on `127.0.0.1:4173/checkout/...`, returning to Fantasio's host shows the empty cart. The same products create a new order number.

**Tests:**
- Unit: `store-host.test.ts`, `resolve-storefront.test.ts`, `check-cart-order.test.ts`, `storefront.test.ts`, `catalog-cart-storage.test.ts`.
- Integration: the `/api` guard, and the route titles in section 14.
- E2E: `public-catalog.spec.ts` and `public-catalog-theme.spec.ts` on the brand host.

**Depends on:** T1.

### T5. Documentation promotion and full journey check

**Scope:**
- Rewrite `docs/public-catalog.md`: brand address, host resolution, field next to the switch, publish rule, legacy redirect, cart after confirming with the reason, wildcard HTTPS, `CATALOG_BASE_URL`.
- Rewrite the related parts of `docs/checkout.md`: the **Publicar catálogo** card and the cart emptied after confirming.
- Add `CATALOG_BASE_URL` and the infra procedure to the README or deployment doc where `BETTER_AUTH_URL` is documented.
- Delete `docs/drafts/catalog-subdomain.md` and this draft (Documentation skill).
- Run the full suite. Run one manual local pass: seller on web chooses and publishes, buyer on `fantasio.localhost` orders.

**Out of scope:** behavior changes.

**Acceptance criteria:**
1. Product acceptance criterion 21.
2. No permanent doc mentions `/catalogo/:companyId` as the catalog address, except as the legacy redirect.

**Tests:** none new. The full CI.

**Depends on:** T2, T3, T4.

### Infra (founder, manual)

No agent has Cloudflare or Coolify credentials. Steps in order:

1. **Origin certificate** (per question 1, recommended option).
   - Cloudflare → SSL/TLS → Origin Server → **Create certificate**: RSA, hostnames `*.yoyos.lat` and `yoyos.lat`, 15 years.
   - Save the certificate as `/data/coolify/proxy/certs/yoyos-origin.pem` and the key as `/data/coolify/proxy/certs/yoyos-origin.key` on the VPS (`chmod 600` on the key).
   - Coolify → Servers → the VPS → Proxy → **Dynamic Configurations** → add `yoyos-origin.yaml`:

     ```yaml
     tls:
       certificates:
         - certFile: /traefik/certs/yoyos-origin.pem
           keyFile: /traefik/certs/yoyos-origin.key
     ```

     Then restart the proxy if Coolify asks.
2. **Coolify routing.** Project → `web` service → **Domains**: keep `https://app.yoyos.lat` and add `https://*.yoyos.lat` (comma-separated). Deploy, then open **Show deployable compose** and check that the `web` router labels contain a rule matching any one-label subdomain:
   - Traefik v3: ``HostRegexp(`^[a-z0-9-]+\.yoyos\.lat$`)``
   - Traefik v2: ``HostRegexp(`{subdomain:[a-z0-9-]+}.yoyos.lat`)``

   If Coolify does not generate it, add these custom labels to `web` (v3 syntax shown; keep Coolify's existing labels):

   ```text
   traefik.http.routers.yoyos-stores.rule=HostRegexp(`^[a-z0-9-]+\.yoyos\.lat$`)
   traefik.http.routers.yoyos-stores.entrypoints=https
   traefik.http.routers.yoyos-stores.tls=true
   traefik.http.routers.yoyos-stores.priority=1
   traefik.http.routers.yoyos-stores.service=<the web service name Coolify generated>
   ```

   The low priority keeps `app.yoyos.lat`'s exact rule first. No `certresolver` goes on this router: Let's Encrypt cannot issue a wildcard through HTTP-01, and Traefik serves the origin certificate from step 1.
3. **Environment.** Coolify → `web` → Environment Variables: `CATALOG_BASE_URL=https://yoyos.lat`. Redeploy.
4. **Cloudflare DNS.** DNS → Records → **Add record**: type `A`, name `*`, IPv4 `94.72.118.64`, Proxy status **Proxied** (orange), TTL Auto. The explicit apex, `www` and `app` records keep precedence over the wildcard.
5. **Cloudflare SSL mode.** SSL/TLS → Overview: **Full (strict)**. If the zone is already Full (strict), nothing changes. Check that the redirect rules for the apex (`yoyos.lat` → `app.yoyos.lat` for core paths) and for `www` match exact hostnames (`http.host eq "yoyos.lat"`), not the wildcard.
6. **Verify:**

   ```sh
   dig +short fantasio.yoyos.lat                        # Cloudflare IPs (not the VPS IP)
   curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://no-existe.yoyos.lat/   # 404 0
   curl -sS https://no-existe.yoyos.lat/ | grep -c 'Catálogo no disponible'                       # 1
   curl -sSI https://<published>.yoyos.lat/ | grep -iE '^(HTTP|referrer-policy)'                 # 200, no-referrer
   curl -sS https://<published>.yoyos.lat/ | grep -c 'noindex'                                   # 1
   curl -sS -o /dev/null -w '%{http_code}\n' https://<published>.yoyos.lat/api/me                # 404
   curl -sSI https://app.yoyos.lat/catalogo/<company id> | grep -iE '^(HTTP|location)'           # 308, https://<published>.yoyos.lat/
   curl -sSI https://yoyos.lat/ | head -1                                                         # landing unchanged
   curl -sSI https://www.yoyos.lat/ | grep -i '^location'                                         # still to the apex
   # Origin answers the wildcard with the origin certificate (validated against Cloudflare's Origin CA root):
   curl -sS --resolve fantasio.yoyos.lat:443:94.72.118.64 --cacert origin_ca_rsa_root.pem \
     -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://fantasio.yoyos.lat/            # 404 or 200, 0
   ```

   `origin_ca_rsa_root.pem` is Cloudflare's published Origin CA RSA root. Until a catalog is published, use any free name: it must answer «Catálogo no disponible».

### Final verification

- The manual checks in section 14 on a phone after the infra steps and the deploy: brand host over HTTPS without warnings, the bfcache back button in Safari iOS, the mobile keyboard and screen reader behavior.
- The `curl` checks above.
- Results go in the pull request description.

## 17. Open items and questions

```text
Questions (answer with the option number):

1. How is the origin authenticated for *.yoyos.lat between Cloudflare and Coolify's Traefik?
   (1) Cloudflare Origin CA certificate for *.yoyos.lat installed in Traefik, SSL mode Full (strict). Recommended: one manual step, valid 15 years, no credentials on the server, and Cloudflare keeps verifying the origin.
   (2) A Configuration Rule with SSL "Full" (not strict) for *.yoyos.lat, using Traefik's default self-signed certificate. No certificate work, but Cloudflare stops verifying the origin for brand hosts.
   (3) Let's Encrypt wildcard through DNS-01 in Traefik with a Cloudflare API token on the VPS. Automatic renewal, but a DNS-editing token lives on the server, and Coolify's proxy configuration grows.

2. What does staging use as CATALOG_BASE_URL (compose.prod.yaml defaults BETTER_AUTH_URL to https://yoyos.kogozstaging.lat)?
   (1) A base on the staging zone (e.g. https://kogozstaging.lat), with the same wildcard steps there. Recommended: brand hosts work end to end on staging, and links never point to production.
   (2) Staging without brand hosts: CATALOG_BASE_URL set to a staging-only name without wildcard DNS. Seller flows are testable there, but buyer flows only locally.
   (3) Staging is not deployed anymore: CATALOG_BASE_URL is only set for production.

Decided unless objected:
- The subdomain is a nullable unique column Company.catalogSubdomain. A CHECK on Company makes a published catalog without a subdomain impossible.
- The migration hides every published catalog and assigns no subdomain, atomically with the deploy.
- The reserved list lives only in code (shared/catalog-subdomain.ts). The format is also a database CHECK.
- One SECURITY DEFINER function, resolve_catalog_subdomain_company, answers who owns a subdomain, following resolve_buyer_order_company. The Company RLS policy is unchanged.
- One variable, CATALOG_BASE_URL, per environment (prod https://yoyos.lat, dev http://localhost:<port>, e2e http://localhost:4173). Required in production. Dev and tests use *.localhost.
- A one-label host under the base, other than the app host, is a store host. Reserved or malformed labels render «Catálogo no disponible».
- /api/* on a brand host answers 404. Session cookies stay host-only on app.yoyos.lat.
- The legacy /catalogo/:id and its product pages answer 308 with the query kept. The legacy cart route keeps the catalog-turned-off outcome.
- The cart is emptied by a storefront check (POST /carrito check_order) on load and on bfcache restore. The checkout no longer touches the cart.
- Continuar navigates to the full checkout URL on the app host.
- The availability check is a separate read-only endpoint. The save is a separate endpoint and idempotent for the same value. The suggestion is computed by core in the settings read.
- Web keeps loaders and actions (save-subdomain intent plus an availability resource route). Mobile uses the JSON API with the same shared schemas.
- The settings response changes shape. Old mobile builds stop reading it (accepted by the product).
- Logs never include the subdomain value, the Host header or the order id.
- Five tasks in three waves: T1, then T2, T3 and T4 in parallel, then T5. The infra steps are manual for the founder.
```
