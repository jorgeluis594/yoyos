# Products in AI assistants: technical design

**Status:** design closed, pending implementation (round 2 of the architecture review gate; the question of round 1 is in [Questions decided by the review gate](#17-questions-decided-by-the-review-gate)). Based on [`docs/drafts/mcp-products.md`](mcp-products.md) (product definition closed by the review gate on 31/10/2026). Base: `jorgeluis594/mcp-2-4-productos-con-filtros-nuevos-en` at `5a3f5417`, on top of MCP 1/4 (`eba41e1a`, #311). Todoist 6hrqGV59mx8H4p7V.

## 1. Technical goal

The MCP server of MCP 1/4 gets a second read-only tool module, `products:read`, with **Buscar productos** (`buscar_productos`) and **Ver producto** (`ver_producto`).
- Every new authorization grants `orders:read products:read offline_access`.
- A connection that does not hold every required data scope is ended the next time it is used, listed or re-authorized. Its agent then re-authorizes with its own client.
- The server instructions tell the agent to answer in the owner's language, for every module.
- The tools read through composed operations of `features/products` and `features/catalog`. Each tool call runs in one read snapshot with a fixed time budget and a constant number of statements, all of them using indexes that lead with `companyId`.
- `features/assistants` never imports products or catalog internals. It declares its own `Projectable*` types and ports, and `src/composition/assistant-product-capabilities.ts` translates between them, as MCP 1/4 does for orders.

```text
agent ──POST /mcp──▶ mcp-routes ─▶ resolveAssistantAccess (unchanged path; ends connections missing a required scope)
                                  └▶ tool-registry ─▶ answerToolCall ─▶ products-tools.ts (assistants-owned ports and types)
                                                                         │
                       src/composition/assistant-product-capabilities.ts (maps types, ≤ 3 reads in flight per process)
                                                                         │
                         products.readForAssistant(work)   one RepeatableRead snapshot: maxWait 1 s, timeout 5 s, 400 ms per statement, jit off
                           ├─ catalogStorefront.describe(companyId)    1 statement
                           ├─ products.searchForAssistant(request)     1–4 statements
                           └─ products.findForAssistant(reference)     1–7 statements
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Tool module | `createProductToolsModule(deps)` in `features/assistants/presentation/tools/products-tools.ts`. Scope `products:read`, `access: "read"`, its own instructions paragraph and reading-failure text. It is registered in `src/composition/assistant-tools.ts` after the order module. The server, transport, limiter and access path do not change for it. |
| Feature boundary | `features/assistants` imports nothing from `features/products` or `features/catalog`. The ports (`ProductToolsDependencies`, `ProductSearchRequest`, `ProductSearchAnswer`, `ProductReferenceRequest`) are declared in `products-tools.ts`. The projectable types (`ProjectableProductSummary`, `ProjectableProduct`, `ProjectableStorefront`, `ProjectableValueRejection`) are declared in `assistants/domain/product-projection.ts`. `src/composition/assistant-product-capabilities.ts` maps the products and catalog types onto them, the pattern of `assistant-order-capabilities.ts`. |
| Raw input to typed values | The assistant sends plain data: text, the raw `valores` strings, integer cents and literal unions. `features/products` parses that data inside its own use case: `matchKeyOf`, `parsePriceCents`, and the «Opción: valor» split. Branded products types never cross the boundary. |
| Scope | `products:read` is added to `assistantScopes`, and `grantedOAuthScope` becomes `orders:read products:read offline_access`. Every connection and token gets both data scopes; there is no per-category choice. |
| Ending connections authorized before this task | No migration. `connectionEndReason(connection, now, inactivityDays, requiredScopes)` ends a connection that lacks any of `requiredScopes` as `consent_outdated`. Every caller passes `assistantScopes`, so MCP 3/4 and 4/4 get the same behavior by adding their literal (question 1, decided). The four callers of `isConnectionActive` then treat an orders-only connection exactly like an inactive one: tool call, list, `/authorize` screen guarantee, and `saveConnection`. It is hidden from «Asistentes de IA». On its next call the row is deleted and the grant revoked, with reason `consent_outdated`. On the next `/authorize` its prior grant is revoked. When the owner allows again, the row is reactivated with the new scopes. |
| Prior grant at re-authorization | When `/authorize` finds no active connection for (client, account), the hook calls `revokeClientGrant` instead of `dropConsent`. That revokes the client's refresh and access tokens for that account and deletes its consent. Tokens minted from the old grant therefore stop working before the new grant exists, both on this release path and after a password change whose best-effort cleanup failed. |
| Registered clients | Before this task every dynamic client was registered with `scopes = {orders:read, offline_access}`. The plugin refuses an `/authorize` whose scope is not a subset of the client's (`invalid_scope`), and it checks scope before session. The `/authorize` hook therefore aligns the client's stored scopes with `oauthScopes` before the plugin reads the client: one conditional `UPDATE` on the global `oauthClient` row, a no-op when the sets already match. It runs only on `/authorize`, never on `/mcp`. |
| Language | `generalInstructions` says to answer in the owner's language and to keep store data unchanged. In the order paragraph, «cítalo tal cual» becomes «transmite su sentido sin convertirlo en una promesa, en el idioma del dueño». `checkToolModules` refuses any instruction, title or description that says to answer in Spanish or to quote «tal cual». Tool names, inputs and messages stay in Spanish. |
| Reading-failure text | Per module: `ToolModule.readFailureMessage`. The registry uses it for an output that fails its schema and for a thrown run, instead of the order text it uses for every module today. |
| Product reads | Through composed operations of `features/products` (`products.readForAssistant`, `products.searchForAssistant`, `products.findForAssistant`). Never through REST, never through another feature's repository. |
| Search contract | `shared/contracts/products.ts` (`productListQuerySchema`) does not change. Reason: no second application consumes the filters yet (guide rule 5.2). Also, the app list's `stock=sold_out` is a product-level rule («every active variant at 0»), while the assistant's `agotado` is a variant-level one («at least one active variant at 0»), so merging them now would change the app list. When the app list gets the filters, its contract adds fields mapped onto `AssistantProductSearch` (renamed then to a neutral name) and its handler calls the same use case. The meeting point is the products input type, not the HTTP schema. |
| Time budget per call | One `withinTransaction` per tool call, opened by `products.readForAssistant` with `{ isolationLevel: "RepeatableRead", maxWait: 1000, timeout: 5000, statementTimeoutMs: 400 }` and `jit = off` (section 11). These are constants (`assistantReadBudget`), not environment variables. A unit test pins the rule `maxStatements × statementTimeoutMs + 1000 ≤ timeout`. |
| Concurrency | At most 3 assistant product reads are in flight per process. A 4th call answers the reading-failure text at once, so product calls can hold at most 3 of the pool's 10 connections (`DATABASE_POOL_MAX` default). |
| Stock levels | `features/products/domain/stock-level.ts` holds `lowStockThreshold = 3`, `stockLevelOf(quantity)` and the per-variant filter. The threshold is one constant, the same for every store, changed only by Yoyos; MCP 4/4 owns later changes. SQL receives the threshold as a parameter, never as a literal. The products feature computes the level and assistants receives it as a value; assistants never applies the threshold. |
| «En el catálogo» | At least one variant with `status = 'active'` (`Product.status` is always `active`). Computed in SQL with the same `EXISTS` as the public catalog. |
| Customer link | `storeUrl(subdomain, "/productos/<id>")` (`storeUrl` of `features/catalog`, the path the public catalog and the legacy redirect already use). It is given only when the catalog is published, the product is in the catalog and the product currency equals the store currency. The currency condition is the public catalog's own filter, so the link never leads to a missing page. No server guard keeps a product in the store currency today (section 15). Such a product shows «En el catálogo» without a customer link. |
| Text match | `unaccent(lower(x)) LIKE unaccent(lower('%texto%'))` on `Product.name` and on any `ProductVariant.sku` (active or not), with `%`, `_` and `\` escaped, like the public catalog search. One phrase, no word split. |
| Value match | Exact on the whole name after `matchKeyOf` (NFD, combining marks removed, lower case, trimmed). Done in TypeScript over the store's vocabulary of names. The vocabulary yields the matching written spellings, and SQL filters by those spellings with plain equality. There is one normalizer; SQL never has a second one. |
| «Opción: valor» | A `valores` entry splits at its first `:` only when the left side is an option of the store. Otherwise the whole entry is a value, so «3:4» or «10:30» stay reachable. When neither the left side is an option nor the whole entry a value, the answer is the unknown-option text. |
| Output lengths | As in MCP 1/4: product names shortened to 100 characters and combinations to 50, with `…` at the end. In **Buscar productos** SKUs are shortened to 40 characters; **Ver producto** shows SKUs and option values whole. The 24 KB cases of the product draft are proved for ASCII text. A two-byte text at the same lengths answers complete (section 15). |
| Indexes | No new index and no migration. Every access uses existing B-tree indexes that lead with `companyId` (section 7). T3 checks the plans as `core_app` under RLS on seeded stores. |
| Response budget | 24 KB per answer, as in MCP 1/4. The static validator checks the three budget cases of section 14, and a fourth test checks that a 100-variant product answers complete. A larger answer is sent complete. |
| Deferred | Margins (no owner task; flagged in the product draft). Sorting by price or stock. A configurable threshold (MCP 4/4). The app list filters. A server guard that keeps product currency equal to store currency. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Tool module contract | `features/assistants/presentation/tool-module.ts` | `{ scope, access: "read", instructions, tools }`; no reading-failure text per module |
| Registry and validator | `presentation/tool-registry.ts`, `src/composition/assistant-tools.test.ts` | `readFailureMessage` is the order text for every module. `checkToolModules` checks names, titles, strict input, annotations, samples and 24 KB (`Buffer.byteLength`). |
| Order capability mapping | `src/composition/assistant-order-capabilities.ts`, `assistants/domain/order-projection.ts` | The projection imports nothing and declares `ProjectableOrder` and the other `Projectable*` types. The composition maps the orders types onto them and logs `assistant_tool_failed`. |
| Server instructions | `presentation/server-instructions.ts` | «Responde siempre en español…» in `generalInstructions` |
| Order paragraph | `presentation/tools/orders-texts.ts` (`orderToolsInstructions`) | Contains «cítalo tal cual» |
| Scopes | `domain/scopes.ts` | `assistantScopes = ["orders:read"]`. `oauthScopes` and `grantedOAuthScope` are derived from it. Used by `auth.ts`, the metadata, the token verifier and the connection rows. |
| Connection activity | `domain/assistant-connection.ts` `isConnectionActive(connection, now, inactivityDays)` | Inactivity window and password change only. Used by `resolve-assistant-access.ts`, `list-assistant-connections.ts`, `auth-hooks.ts` (`createHasActiveConnection`) and `connection-repository.ts` (`saveConnection`, which reactivates an inactive row with the new scopes). |
| Access per call | `application/resolve-assistant-access.ts` | Ends inactive or password-changed connections through `endConnection(connection, "inactive" \| "password_reset")`. Requires `orders:read` in both token and connection. `RefusalReason = not_ready \| no_connection \| inactive \| password_changed \| scope`. |
| Authorization | `application/authorize-assistant.ts` | Saves `scopes: ["orders:read"]` |
| `/authorize` hook | `infrastructure/oauth-hooks.ts` | Rewrites the requested scope to `grantedOAuthScope`. Reads the session. When there is no active connection, drops the stored consent (`dropConsent`); tokens are not revoked. |
| Grant revocation | `infrastructure/oauth-grant-revocation.ts` `revokeClientGrant` | Revokes the client's refresh and access tokens for one account and deletes its consent. Used when a connection ends. |
| Plugin order | `@better-auth/oauth-provider` 1.7.14, `authorizeEndpoint` | Reads the client, refuses scopes outside `client.scopes` with `invalid_scope`, and only then reads the session. `validateClientScopes` also runs on the refresh grant. |
| Token lifetimes | `infrastructure/assistant-config.ts` | Access 3,600 s, refresh 90 days |
| Connection log | `connection-repository.ts` `assistant_connection_created` | Same event for `inserted` and `reactivated`, with no outcome field |
| Consent and settings texts | `app/locales.ts` `assistants.*` (es, pt); `app/routes/assistant-authorize.tsx`, `app/routes/assistant-settings.tsx` (+ tests) | Orders only. `canSee1..3`, `never1..2`, `settingsIntro`, `disconnectBody`. |
| Product list (app) | `features/products/application/list.ts`, `infrastructure/repository.ts` `list`, `summarySql` | `search` (ILIKE on name or SKU), product-level `stock`, `sort`, page. One id query plus one grouped summary query, which joins `ProductPhoto`. |
| Public catalog reads | `features/products/infrastructure/catalog-products-repository.ts` | Active product with an active variant and `currency = store currency`; `unaccent(lower(name)) LIKE …` |
| Product aggregate read | `productRepository.get` (`infrastructure/repository.ts` `readProducts`) | Six batched queries per call, validated rows. Inside a transaction it rethrows transaction failures (`transactionFailureStage`: statement timeout, P2028) instead of logging them as persistence failures. |
| Statement-timeout detector | `features/products/infrastructure/text-candidates.ts` `isStatementTimeout`; `shared/infrastructure/persistence-error.ts` `transactionFailureStage` | The first recognizes `57014` at any driver layer. The second classifies both `57014` and P2028 as `transaction_timeout`. `text-candidates.ts` sets `jit` off with `set_config` inside its transaction. |
| Saved variant order | `domain/product-structure.ts` `sortVariants`, `orderedAttributes` | Pure, computed from the aggregate's option and value positions. Limits: 3 options, 30 values, 100 variants. |
| SKU lookup | `infrastructure/repository.ts` `findSkuOwners`; `order-stock.ts` `findProductIdsOfVariants` | By `lower(btrim(sku))`, served by `ProductVariant_companyId_sku_normalized_key` |
| Catalog settings | `features/catalog/infrastructure/catalog-settings-repository.ts` `readCatalogSettings`; `storefront-config.ts` `storeUrl(subdomain, path = "/"): URL` | Published flag, subdomain and company name; no country or currency. `catalogSettings.get` also computes a subdomain suggestion (one extra query). |
| Storefront capability | `features/catalog/composition.ts` `catalogStorefront` | `{ resolve, resolveOwner }` by host; no read by company |
| Store currency | `@shared/country` `countryCurrencies[Company.country]` | Used by `resolveSubdomain`. Product creation takes `currency` from the request, and the web form sends the store currency; there is no server guard. |
| Product indexes | `prisma/migrations/*` | `Product(companyId)`; `Product.name` GIN trigram (global). `ProductVariant` unique `(companyId, id)`, `(companyId, productId, id)`, `(companyId, productId, combinationKey)`, and partial `(companyId, lower(btrim(sku)))`; `ProductVariant.sku` GIN trigram (global). `ProductStock` unique `(companyId, variantId)`. `ProductVariantOptionValue` PK `(companyId, variantId, optionId)` and index `(companyId, optionId, valueId)`. `ProductOption` unique `(companyId, productId, id)`. `ProductOptionValue` unique `(companyId, optionId, id)`. Extensions `pg_trgm`, `unaccent`. |
| Transactions | `shared/infrastructure/persistance.ts` | `withinTransaction(…, { timeout, maxWait, isolationLevel, statementTimeoutMs, lockTimeoutMs })`. A nested call joins the outer transaction and ignores its own options. There is no read-only option. `withinReadSnapshot` is RepeatableRead with the default 5,000 ms timer. A read outside a transaction opens its own tenant transaction. |
| Assistant tests with old scopes | `presentation/mcp-routes.integration.test.ts` (rows with `scopes: ["orders:read"]`, fixture module), `application/assistant-fixtures.ts`, `application/connections.test.ts` | They encode the orders-only connection as active. |
| Web E2E | `apps/core/tests/e2e/assistants.spec.ts` | Consent and settings journey with order texts |

## 4. Gaps this design closes

1. There is no `products:read` scope, no product tool and no consent line for products (sections 5.1, 5.4, 12).
2. Connections authorized before this task keep working with orders only, their clients cannot request the new scope, and their old tokens survive reactivation (sections 5.2, 5.3).
3. The server instructions and the order paragraph impose Spanish answers and literal quotes (section 5.5).
4. The registry answers a product failure with the order reading-failure text (section 5.5).
5. `features/products` has no filtered search by variant values, price range, variant stock level or catalog presence. It also has no store vocabulary of option values and no read by SKU for the assistant (sections 5.6, 5.7, 7).
6. There is no single definition of «stock bajo» that MCP 4/4 can reuse (section 6.1).
7. `features/catalog` has no cheap read of the storefront state with the store currency (section 5.8).
8. No product read has a bounded total time, and nothing limits how many connections of the shared pool the reads hold (section 11).

## 5. Use cases

### 5.1 `authorizeAssistant` (modified, assistants)

The saved connection carries `scopes: [...assistantScopes]` instead of `["orders:read"]`. Nothing else changes.

### 5.2 Connection activity (modified, assistants domain)

```ts
export type ConnectionEndReason = "inactive" | "password_reset" | "consent_outdated";
/** Null while the connection is active. Checks the password change first, then a missing required scope, then inactivity. */
export function connectionEndReason(connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number,
  requiredScopes: readonly AssistantScope[]): ConnectionEndReason | null;
export function isConnectionActive(connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number,
  requiredScopes: readonly AssistantScope[]): boolean; // connectionEndReason(...) === null
```

The result is `consent_outdated` when `requiredScopes.some((scope) => !connection.scopes.includes(scope))`. Every production caller passes `assistantScopes`. Tests pass their own list, for example a third scope, without touching the constant.

`resolveAssistantAccess` (modified):
- It uses `connectionEndReason`. For a non-null reason it calls `endConnection(connection, reason)` and refuses with `RefusalReason` `password_changed`, `consent_outdated` (a new literal) or `inactive`. The reason type of `endConnection` becomes `ConnectionEndReason`.
- The `orders:read` requirement becomes «the intersection of token and connection scopes is not empty».
- A token minted before re-authorization exposes only the tools of its own scopes. It can still exist only in two cases:
  - an access token of a connection that was never re-authorized, which ends on its first use;
  - a token minted after the hook revoked the grant, which carries the new scopes.
- No new lookup is added to the path.

`listAssistantConnections`, `createHasActiveConnection` and `saveConnection` change only to pass `assistantScopes`.

### 5.3 `/authorize` hook (modified, assistants infrastructure)

```ts
// OAuthHookDependencies changes:
alignClientScopes: (oauthClientId: OAuthClientId) => Promise<Result<"aligned" | "unchanged", HookFailure>>;  // new
revokePriorGrant: (userId: UserId, oauthClientId: OAuthClientId) => Promise<Result<RevokedGrant, HookFailure>>; // replaces dropConsent
```

Flow of `authorizeHook`:

1. Parse the parameters (unchanged).
2. Call `alignClientScopes(client_id)`, before the session read:
   ```sql
   UPDATE "oauthClient" SET scopes = $oauthScopes
   WHERE "clientId" = $id AND NOT (scopes @> $oauthScopes AND scopes <@ $oauthScopes)
   ```
   - It runs through `systemPrisma`, because `oauthClient` is a global table.
   - It compares sets, so a row stored in another order is not rewritten. When the scopes already match, which is every authorize after the first, it writes nothing.
   - An unknown client updates nothing, and the plugin answers its own error.
   - A persistence failure throws `503 server_error`, like the other hook failures.
   - A real write logs `assistant_client_scopes_aligned`.
3. Read the session, check the marker and look for an active connection (unchanged).
4. With no active connection, call `revokePriorGrant(userId, client_id)`: `revokeClientGrant` with `revokedAt = now`. It revokes the client's refresh and access tokens for this account and deletes its consent. A failure throws `503`, as `dropConsent` does today.

Why before the session read: the plugin checks `client.scopes` before it reads the session (`authorizeEndpoint` in 1.7.14). An agent that is not signed in would get `invalid_scope` before ever reaching the login page.

Why the unauthenticated write is acceptable:
- It can only set a client's scopes to `oauthScopes`, the exact set that open dynamic registration already grants to anyone.
- It is a no-op once aligned.
- The per-IP authorize rate limit applies.
- Nested authorize dispatches repeat it as a no-op.

Why a hook and not a data migration: with question 1 every later data scope needs the same alignment. The hook aligns on demand with no migration per scope, and it also covers a client registered by an older running instance during a rolling release.

Why the grant is revoked at `/authorize`: here the connection is already inactive, so its tokens are useless for tools (`resolveAssistantAccess` refuses them). Revoking them before the new code exists cannot touch the new grant, and it closes the path where reactivation would leave the old refresh tokens working for 90 days.

Assumption verified in T1: the column is `oauthClient.scopes` (`String[]`), and the plugin reads the client after `hooks.before` returns.

### 5.4 Product tool calls (new, assistants presentation)

Both tools run inside the connection's tenant context (`withTenantIsolation` of `mcp-routes`), after the unchanged pipeline of `answerToolCall` (store limit, «Último uso», input schema). Their ports, all declared in `products-tools.ts`:

```ts
export type ProductSearchRequest = Readonly<{
  text?: string;                                  // trimmed, 1..120 characters
  values?: readonly [string, ...string[]];        // raw «Azul» or «Color: Azul», at most 3, each trimmed
  priceFromCents?: number; priceToCents?: number; // safe non-negative integers, validated to two decimals by the input schema
  stock?: "in_stock" | "low" | "sold_out";
  inCatalog?: boolean;
  sort: "recent" | "name";
  page: number;
}>;
export type ProductSearchAnswer = Readonly<{ storefront: ProjectableStorefront }> & (
  | Readonly<{ kind: "page"; items: readonly ProjectableProductSummary[]; page: number; total: number; storeHasProducts: boolean }>
  | Readonly<{ kind: "price_range_reversed" }>
  | Readonly<{ kind: "variant_filter_outside_catalog" }>
  | Readonly<{ kind: "value_rejected"; rejection: ProjectableValueRejection }>);
export type ProductReferenceRequest = Readonly<{ by: "id"; id: string }> | Readonly<{ by: "sku"; sku: string }>;
export type ProductToolsDependencies = Readonly<{
  appLink: (productId: string) => string;                                       // `${authIssuer}/products/<id>`
  search: (request: ProductSearchRequest, access: AssistantAccess) => Read<ProductSearchAnswer>;
  find: (reference: ProductReferenceRequest, access: AssistantAccess) => Read<Readonly<{ storefront: ProjectableStorefront; product: ProjectableProduct | null }>>;
}>;
type Read<T> = Promise<Result<T, ToolRunError>>;
```

`src/composition/assistant-product-capabilities.ts` implements `search` and `find`:

1. It takes a slot of the per-process limit of 3 reads in flight. With no slot free, it answers `{ code: "FAILURE" }` with the products reading-failure text and logs `assistant_tool_failed` with `errorCode: "READS_BUSY"`. It does not wait.
2. It calls `products.readForAssistant(async () => …)`. Inside that one snapshot it runs `catalogStorefront.describe(access.companyId)`, then `products.searchForAssistant(toProductsSearch(request))` or `products.findForAssistant(reference)`.
3. It maps the result:
   - products and catalog types become the `Projectable*` types;
   - `customerLink` is computed when the catalog is published, the product is in the catalog and the product currency equals the store currency;
   - the stock level comes from products as a value;
   - `PRICE_RANGE_REVERSED`, `VARIANT_FILTER_OUTSIDE_CATALOG` and `VALUE_REJECTED` become the answer kinds.
4. A read failure (`PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA`, `STATEMENT_TIMEOUT`, `TRANSACTION_TIMEOUT`) is logged once as `assistant_tool_failed` with its `errorCode` and answered as `{ code: "FAILURE", message: productReadFailureText }`.
5. It releases the slot in `finally`.

**`buscar_productos`**

1. Map the validated Spanish input to `ProductSearchRequest`:
   - «con stock» → `in_stock`, «stock bajo» → `low`, «agotado» → `sold_out`;
   - «sí»/«si» → `true`, «no» → `false`;
   - amounts become integer cents (`Math.round(amount * 100)` after the schema has checked at most two decimals, non-negative and the stored maximum);
   - `valores` passes through as written, trimmed.
2. `search(request, access)`.
3. Map the answer:
   - `price_range_reversed` and `variant_filter_outside_catalog` → `INVALID_INPUT` with the product draft texts;
   - `value_rejected` → `INVALID_INPUT` with `vocabularyMessage(rejection)`;
   - `page` → the output, with `toAssistantProductSummary` per item, the catalog line and `hay_mas`.
   - For an empty page, add `mensaje`: «No hay productos con esos filtros: …» from the request, or «Tu tienda todavía no tiene productos.» when `storeHasProducts` is false. An empty page is `empty: true`.

**`ver_producto`**

1. The input is exactly one of `producto` and `sku`. A `producto` that is not a UUID is treated as unknown, with the same answer as not found and no read.
2. `find(reference, access)`. `product: null` → `NOT_FOUND` with «No encontré ese producto en tu tienda. Búscalo con Buscar productos.».
3. `toAssistantProduct(product, storefront, context)`.

Errors: `ToolRunError` codes `INVALID_INPUT`, `NOT_FOUND` and `FAILURE`; nothing else reaches the agent.

### 5.5 Language and module failure text (modified, assistants presentation)

- `generalInstructions`: the Spanish-only sentence is replaced by the rule of the product draft ([Language](mcp-products.md#language)). Answer in the language the owner writes in. Tool texts come in Spanish and are translated. Product names, combinations, values, SKUs, links, amounts, dates and order numbers are store data and stay unchanged. (T2)
- `orderToolsInstructions`: «cítalo tal cual» → «transmite su sentido sin convertirlo en una promesa, en el idioma del dueño». (T2)
- `checkToolModules` reports an instruction paragraph, title or description that contains «en español» (accent- and case-insensitive) or «tal cual». (T2)
- `ToolModule` gets `readFailureMessage: string`, and `ToolDefinition` carries it. `render` uses `definition.readFailureMessage` for `INVALID_TOOL_OUTPUT` and for a `failure` with `message: null`. The order module sets the current order text. The exported `readFailureMessage` constant of the registry is removed. `checkToolModules` reports a module whose `readFailureMessage` is empty. (T5)

### 5.6 `searchForAssistant` (new, products application)

File `features/products/application/search-for-assistant.ts`. The tenant comes from the transaction context, as in every product adapter, so the use case takes no access parameter.

```ts
/** Plain input: parsed here, never by the caller. */
export type AssistantProductSearch = Readonly<{
  text?: string; values?: readonly string[]; priceFromCents?: number; priceToCents?: number;
  stock?: VariantStockFilter; inCatalog?: boolean; sort: "recent" | "name"; page: number;
}>;
export type SearchForAssistantDependencies = Readonly<{
  snapshot: AssistantSnapshot;                                  // joins the call's snapshot; opens one with the budget otherwise
  readVocabulary: () => Promise<Result<readonly VocabularyRow[], AssistantReadError>>;
  searchPage: (query: ProductSearchQuery) => Promise<Result<ProductSearchPage, AssistantReadError>>;
}>;
export type SearchForAssistantError =
  | Readonly<{ code: "PRICE_RANGE_REVERSED"; from: PriceCents; to: PriceCents; message: string }>
  | Readonly<{ code: "VARIANT_FILTER_OUTSIDE_CATALOG"; message: string }>
  | Readonly<{ code: "INVALID_PRICE"; message: string }>       // defensive: the assistant schema already refuses it
  | Readonly<{ code: "VALUE_REJECTED"; rejection: ValueRejection; message: string }>
  | AssistantReadError;
export async function searchForAssistant(input: AssistantProductSearch, deps: SearchForAssistantDependencies): Promise<Result<ProductSearchPage, SearchForAssistantError>>;
```

Flow:

1. `parseSearchCriteria(input)` (domain):
   - cents go through `parsePriceCents`;
   - `priceFrom > priceTo` → `PRICE_RANGE_REVERSED`;
   - `inCatalog === false` with any of `values`, `priceFrom`, `priceTo`, `stock` → `VARIANT_FILTER_OUTSIDE_CATALOG`.
2. Inside `snapshot`:
   1. With `values`: `readVocabulary()`, then `buildVocabulary(rows)`, then `resolveValues(input.values, vocabulary)`. A rejection ends the read with `VALUE_REJECTED`.
   2. `searchPage({ text, valueSets, priceFrom, priceTo, stock, inCatalog, sort, offset: (page - 1) * 20, limit: 20, lowStockThreshold, matchingVariantCap: 10 })`.
3. Return the page.

### 5.7 `findForAssistant` (new, products application)

File `features/products/application/find-for-assistant.ts`.

```ts
export type AssistantProductReference = Readonly<{ by: "id"; id: ProductId }> | Readonly<{ by: "sku"; sku: string }>;
export type FoundProduct = Readonly<{ product: Product; searchedVariantId: VariantId | null }>; // product.variants in saved order
export type FindForAssistantDependencies = Readonly<{
  snapshot: AssistantSnapshot;
  findSkuOwner: (normalizedSku: string) => Promise<Result<Readonly<{ variantId: VariantId; productId: ProductId }> | null, AssistantReadError>>;
  getProduct: (id: ProductId) => Promise<Result<Product | null, ProductReadError>>;   // productRepository.get
}>;
export async function findForAssistant(reference: AssistantProductReference, deps: FindForAssistantDependencies): Promise<Result<FoundProduct | null, AssistantReadError>>;
```

Flow inside one snapshot:
1. By SKU, normalize the SKU the way the unique index does (`lower(btrim(sku))`: lower case, surrounding spaces removed). Then `findSkuOwner` returns the variant and its product in one statement, using the same expression index plus one column. Absent → `ok(null)`.
2. `getProduct(id)`. Absent → `ok(null)`.
3. Return the product with `variants: sortVariants(product)` and `searchedVariantId` (null when looked up by id).

Notes:
- `findForAssistant` calls `productRepository.get` directly, not the `getProduct` use case. So no image URL is signed, `IMAGE_NOT_FOUND` cannot fail a read, and the photo ids the aggregate carries are never projected.
- Inside the snapshot, `readProducts` rethrows a statement timeout or P2028, so the snapshot maps it (section 11) instead of it being logged as `product_read_persistence_failed`.
- The composition passes the id from `ProductReferenceRequest` as a `ProductId` only after the presentation has checked it is a UUID.

### 5.8 `catalogStorefront.describe` (new, catalog)

The existing `catalogStorefront` object of `features/catalog/composition.ts` gets `describe`; `resolve` and `resolveOwner` are unchanged.

```ts
export type StorefrontState = Readonly<{ currency: Currency; catalog:
  | Readonly<{ kind: "published"; subdomain: CatalogSubdomain }>
  | Readonly<{ kind: "hidden"; subdomain: CatalogSubdomain }>
  | Readonly<{ kind: "hidden_without_link" }> }>;
describe: (companyId: CompanyId) => Promise<Result<StorefrontState, CatalogSettingsError>>;
```

- It runs one statement, `SELECT "catalogPublished", "catalogSubdomain", country FROM "Company" WHERE id = $companyId`, through the context client: the new `readStorefrontState` in `catalog-settings-repository.ts`.
- When called inside `products.readForAssistant`, it joins that snapshot: one round trip, and the same view as the product rows. It never opens a tenant transaction of its own there.
- The row is parsed with Zod. An invalid subdomain or country → `INVALID_STORED_DATA`. An absent company → `PERSISTENCE_UNAVAILABLE`, because a connection's company always exists.
- Inside a transaction it rethrows transaction failures, as the product adapters do.
- It does not compute a subdomain suggestion.
- The composition builds URLs with `storeUrl(subdomain)` and `storeUrl(subdomain, "/productos/<id>")`.

### 5.9 `products.readForAssistant` (new, products composition)

```ts
export type AssistantReadError = ProductReadError
  | Readonly<{ code: "STATEMENT_TIMEOUT"; message: string }>
  | Readonly<{ code: "TRANSACTION_TIMEOUT"; message: string }>;   // the Prisma timer or maxWait (P2028)
export type AssistantSnapshot = <T, E>(read: () => Promise<Result<T, E>>) => Promise<Result<T, E | AssistantReadError>>;
export const assistantReadBudget = { maxWait: 1000, timeout: 5000, statementTimeoutMs: 400, maxStatements: 10 } as const;
```

It is implemented in `features/products/infrastructure/assistant-read.ts`:
- It opens `withinTransaction` with `isolationLevel: "RepeatableRead"` and the budget. Its first statement is `set_config('jit', 'off', true)`, the precedent of `text-candidates.ts`.
- It catches what the transaction throws:
  - `isStatementTimeout(error)` → `STATEMENT_TIMEOUT`;
  - `transactionFailureStage(error) === "transaction_timeout"` → `TRANSACTION_TIMEOUT`;
  - a known Prisma or driver failure → `PERSISTENCE_UNAVAILABLE`;
  - anything else is rethrown.
- Each failure logs `product_search_failed` with `operation` and `durationMs`.
- `isStatementTimeout` moves from `text-candidates.ts` to `features/products/infrastructure/statement-timeout.ts`, and `text-candidates.ts` imports it.
- When `readForAssistant` already runs, the use cases' `snapshot` joins it. Called alone, the use cases open the same budgeted snapshot.

## 6. Domain and typing

### 6.1 Stock levels (`features/products/domain/stock-level.ts`)

```ts
/** Units at or below which an active variant is «stock bajo». Same for every store; MCP 4/4 owns changes. */
export const lowStockThreshold = 3;
export type StockLevel = "sold_out" | "low" | "available";          // 0 · 1..threshold · above threshold
export type VariantStockFilter = "in_stock" | "low" | "sold_out";    // in_stock = low ∪ available
export function stockLevelOf(quantity: number): StockLevel;
export function matchesStockFilter(quantity: number, filter: VariantStockFilter): boolean;
```

`VariantStockFilter` is new because the app's `StockFilter` (`in_stock | sold_out`) is product-level. A level applies only to active variants; callers never pass a product total.

### 6.2 Search criteria and values (`features/products/domain/product-search.ts`)

```ts
export type MatchKey = string & { readonly __brand: "MatchKey" };
export function matchKeyOf(text: string): MatchKey;                   // NFD, \p{M} removed, toLowerCase, trim
export type PriceCents = number & { readonly __brand: "PriceCents" }; // 0..99_999_999_999 (Decimal(11, 2))
export function parsePriceCents(cents: number): Result<PriceCents, "NOT_AN_INTEGER" | "NEGATIVE" | "TOO_LARGE">;
export type SearchCriteria = Readonly<{
  text?: string; values?: readonly [string, ...string[]]; priceFrom?: PriceCents; priceTo?: PriceCents;
  stock?: VariantStockFilter; inCatalog?: boolean; sort: "recent" | "name"; page: number;
}>;
export function parseSearchCriteria(input: AssistantProductSearch): Result<SearchCriteria, "INVALID_PRICE" | "PRICE_RANGE_REVERSED" | "VARIANT_FILTER_OUTSIDE_CATALOG">;
```

`PriceCents` exists because `Money.amount` is a float. SQL compares `salePrice` with `$cents::numeric / 100`, exactly.

Vocabulary:

```ts
/** One row per distinct (option name, value name) as written, held by an active variant. */
export type VocabularyRow = Readonly<{ optionName: string; valueName: string; productRank: number; position: number }>;
/** The written spellings that merged into one key; SQL matches them with plain equality. */
export type Spelling = Readonly<{ optionName: string; valueName: string }>;
export type StoreVocabulary = readonly Readonly<{ name: string; key: MatchKey;
  values: readonly Readonly<{ name: string; key: MatchKey; spellings: readonly Spelling[] }>[] }>[];
export function buildVocabulary(rows: readonly VocabularyRow[]): StoreVocabulary;
export type ValueRejection =
  | Readonly<{ kind: "no_options" }>
  | Readonly<{ kind: "unknown_value"; written: string; vocabulary: StoreVocabulary }>
  | Readonly<{ kind: "value_in_other_option"; written: string; option: string; vocabulary: StoreVocabulary }>
  | Readonly<{ kind: "unknown_option"; option: string; vocabulary: StoreVocabulary }>;
/** One spelling set per entry, in entry order. */
export function resolveValues(entries: readonly string[], vocabulary: StoreVocabulary): Result<readonly (readonly Spelling[])[], ValueRejection>;
```

`buildVocabulary`:
- It merges rows by option key and, within an option, by value key.
- The written form shown is the one with the lowest `productRank`, which is the newest product.
- Options are sorted by `name.localeCompare(other, "es")`.
- Values are sorted by the `(productRank, position)` of their first occurrence, which reproduces «products newest first, values in saved order».
- The spellings of merged rows are kept.

`resolveValues`:
- An empty vocabulary → `no_options`.
- For each entry:
  - When the entry contains `:` and its trimmed left side is an option key, use the option form:
    - a value key under that option → its spellings;
    - otherwise `value_in_other_option` when another option holds the value, else `unknown_value`.
  - Otherwise the whole entry is a value: the spellings of that value key under every option.
  - None found:
    - `unknown_option` with the left side, when the entry has a non-empty left side and right side;
    - otherwise `unknown_value`.
- The first entry that fails decides.

The 100-value cap and «y 30 valores más» belong to the message, not the domain (section 6.4).

### 6.3 Search page (`features/products/application/search-for-assistant.ts`)

```ts
export type SkuSummary = Readonly<{ kind: "single"; sku: string | null }> | Readonly<{ kind: "several" }>;
export type ActiveSummary =
  | Readonly<{ kind: "none"; sku: SkuSummary }>                       // over all variants
  | Readonly<{ kind: "some"; count: number; minSalePrice: Money; hasDifferentPrices: boolean; totalStock: number; soldOut: number; low: number;
      onlyLevel: StockLevel | null; sku: SkuSummary }>;               // onlyLevel: the level when there is exactly one active variant
export type SearchedVariant = Readonly<{ id: VariantId; values: readonly string[]; sku: string | null; salePrice: Money; stock: number; level: StockLevel }>;
export type SearchedProduct = Readonly<{
  id: ProductId; name: string; currency: Currency; variantCount: number; inactiveCount: number; active: ActiveSummary;
  matching: Readonly<{ variants: readonly SearchedVariant[]; total: number }> | null;  // null without variant filters; at most 10 variants
}>;
export type ProductSearchPage = Readonly<{ items: readonly SearchedProduct[]; page: number; total: number; storeHasProducts: boolean }>;
export type ProductSearchQuery = Readonly<{
  text?: string; valueSets: readonly (readonly Spelling[])[]; priceFrom?: PriceCents; priceTo?: PriceCents; stock?: VariantStockFilter;
  inCatalog?: boolean; sort: "recent" | "name"; offset: number; limit: number; lowStockThreshold: number; matchingVariantCap: number;
}>;
```

`ActiveSummary` is a union, so a product without active variants can never carry a price, stock or level. `SearchedProduct` is new: `ProductSummary` of the app list has no level counts, no inactive count and no matching variants, and the app list must not grow them. The levels are computed with `stockLevelOf` in products.

### 6.4 Assistant projection (`features/assistants/domain/product-projection.ts`)

It imports nothing from another feature. It declares the shapes it renders:

```ts
export type ProjectableLevel = "sold_out" | "low" | "available";
export type ProjectableSku = Readonly<{ kind: "single"; sku: string | null }> | Readonly<{ kind: "several" }>;
export type ProjectableActive =
  | Readonly<{ kind: "none"; sku: ProjectableSku }>
  | Readonly<{ kind: "some"; minSalePrice: Money; hasDifferentPrices: boolean; totalStock: number; soldOut: number; low: number;
      onlyLevel: ProjectableLevel | null; sku: ProjectableSku }>;
export type ProjectableVariantLine = Readonly<{ values: readonly string[]; sku: string | null; salePrice: Money; stock: number; level: ProjectableLevel }>;
export type ProjectableProductSummary = Readonly<{ id: string; name: string; variantCount: number; inactiveCount: number;
  active: ProjectableActive; customerLink: string | null; matching: Readonly<{ variants: readonly ProjectableVariantLine[]; total: number }> | null }>;
export type ProjectableProduct = Readonly<{ id: string; name: string; description: string | null;
  options: readonly Readonly<{ name: string; values: readonly string[] }>[]; active: ProjectableActive; customerLink: string | null;
  variants: readonly (ProjectableVariantLine & Readonly<{ purchasePrice: Money | null; isActive: boolean; searched: boolean }>)[] }>;
export type ProjectableStorefront = Readonly<{ currency: Currency; catalog:
  Readonly<{ kind: "published"; storeLink: string }> | Readonly<{ kind: "hidden" }> | Readonly<{ kind: "hidden_without_link" }> }>;
export type ProjectableVocabulary = readonly Readonly<{ name: string; values: readonly string[] }>[];
export type ProjectableValueRejection =
  | Readonly<{ kind: "no_options" }>
  | Readonly<{ kind: "unknown_value"; written: string; vocabulary: ProjectableVocabulary }>
  | Readonly<{ kind: "value_in_other_option"; written: string; option: string; vocabulary: ProjectableVocabulary }>
  | Readonly<{ kind: "unknown_option"; option: string; vocabulary: ProjectableVocabulary }>;
```

`Money` and `Currency` come from `@shared/money` and `@shared/country`, which are shared modules and not another feature. In `ProjectableProduct.variants`, `level` is meaningful only when `isActive`.

Pure functions, with a `ProductProjectionContext = { display: Display; appLink: (id: string) => string }`:

| Function | Produces |
| --- | --- |
| `catalogLine(storefront)` | The three catalog sentences of the product draft |
| `stockLine(active)` | «Stock: 12 · 1 agotada, 1 con stock bajo», «Stock: 0 · Agotado», «Stock: 6 · 6 con stock bajo», or the level of a one-variant product; `undefined` for `kind: "none"` |
| `toAssistantProductSummary(product, context)` | One search item; never the purchase price |
| `toAssistantProduct(product, storefront, context)` | The **Ver producto** answer; the description is cut at 1,000 characters with «… (la descripción continúa en Yoyos)» |
| `vocabularyMessage(rejection)` | The four texts, with at most 100 values and «y N valores más» |
| `appliedFiltersLine(request, currency)` | «texto "polos", stock bajo, precio hasta S/ 30.00» for empty answers |
| `combinationOf(values)` | The values joined by « / », cut at 50 |

Output types are the `z.infer` of the strict output schemas of `products-tools.ts`, checked with `satisfies` as the order projection does. Field names, in Spanish snake case:

- `buscar_productos`: `{ catalogo, pagina, total, hay_mas?, mensaje?, productos: [{ id, nombre, sku, precio, stock?, en_catalogo, variantes, enlace, enlace_cliente?, variantes_coincidentes?: [{ combinacion, sku, precio, stock, nivel? }], mas_variantes? }] }`.
- `ver_producto`: `{ catalogo, id, nombre, descripcion?, opciones: [{ nombre, valores: [text] }], en_catalogo, stock?, enlace, enlace_cliente?, variantes: [{ combinacion, sku, precio, precio_compra, stock, nivel?, estado: "Activa" | "Desactivada", buscada_por_sku?: true }] }`.

The `stock` of a variant is a number. `nivel` is «Agotado» or «Stock bajo», and is absent above the threshold and on deactivated variants. `precio_compra` is «Sin precio de compra» when absent. No field can hold a QR code, a photo or an image URL.

| Layer | Types and authority |
| --- | --- |
| products domain | `lowStockThreshold`, `StockLevel`, `MatchKey`, `PriceCents`, `SearchCriteria`, the vocabulary and value resolution, the «Opción: valor» split: the only definitions |
| products application and infrastructure | `searchForAssistant`, `findForAssistant`, `readForAssistant`, `AssistantProductSearch`, `SearchedProduct`, `FoundProduct`, `AssistantReadError`, `assistantReadBudget` |
| catalog | `StorefrontState`, `catalogStorefront.describe` |
| src/composition | The only place that sees both sides. It maps products and catalog types onto the `Projectable*` types, computes the customer link, holds the 3-slot limit and logs `assistant_tool_failed`. |
| assistants domain | The `Projectable*` types and the Spanish projection, catalog and stock lines. It decides no product rule. |
| assistants presentation | The ports, the Spanish input schemas and their mapping to `ProductSearchRequest`, the output schemas and the texts |

## 7. Persistence

No schema change, no migration and no data change; `database-migrations` is not involved. `shared/infrastructure/persistance.ts` does not change.

### 7.1 Queries

All of them run inside the call's snapshot under the tenant's RLS context. They also filter `"companyId" = $companyId` explicitly, so the planner can use the indexes that lead with `companyId`.

**Vocabulary** (`readVocabulary`, only when `valores` is sent), names only:

```sql
SELECT o.name AS "optionName", ov.name AS "valueName",
       min(p.rank) AS "productRank", (array_agg(ov.position ORDER BY p.rank, ov.position))[1] AS position
FROM "ProductVariantOptionValue" l
JOIN "ProductVariant" v       ON v."companyId" = l."companyId" AND v.id = l."variantId" AND v.status = 'active'
JOIN "ProductOption" o        ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
JOIN "ProductOptionValue" ov  ON ov."companyId" = l."companyId" AND ov."optionId" = l."optionId" AND ov.id = l."valueId"
JOIN (SELECT id, row_number() OVER (ORDER BY "createdAt" DESC, id) AS rank FROM "Product" WHERE "companyId" = $c) p ON p.id = l."productId"
WHERE l."companyId" = $c
GROUP BY o.name, ov.name
```

- `position` is the value's position in the newest product that holds it. So `(productRank, position)` is one product's saved order and never mixes positions of two products.
- No ids are returned. The rows are the distinct spellings: tens to a few hundred, at most 30 values × 3 options per product, merged across products.
- Rows scanned: the store's variant links (variants × options).
- Indexes: the `ProductVariantOptionValue` PK or `ProductVariantOptionValue_companyId_optionId_valueId_idx` (leading `companyId`), `ProductVariant_companyId_id_key`, `ProductOption_companyId_productId_id_key`, `ProductOptionValue_companyId_optionId_id_key` and `Product_companyId_idx`.

**Page ids, total and store emptiness** (one statement):

```sql
WITH matching AS (
  SELECT p.id, p.name, p."createdAt" FROM "Product" p
  WHERE p."companyId" = $c
    [AND (unaccent(lower(p.name)) LIKE unaccent(lower($pattern))
          OR EXISTS (SELECT 1 FROM "ProductVariant" sv WHERE sv."companyId" = p."companyId" AND sv."productId" = p.id
                     AND unaccent(lower(sv.sku)) LIKE unaccent(lower($pattern))))]
    [AND [NOT] EXISTS (SELECT 1 FROM "ProductVariant" a WHERE a."companyId" = p."companyId" AND a."productId" = p.id AND a.status = 'active')]
    [AND EXISTS (SELECT 1 FROM "ProductVariant" v
                 JOIN "ProductStock" s ON s."companyId" = v."companyId" AND s."variantId" = v.id
                 WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active'
                   [AND v."salePrice" >= $from::numeric / 100] [AND v."salePrice" <= $to::numeric / 100]
                   [AND s.quantity = 0 | s.quantity BETWEEN 1 AND $threshold | s.quantity > 0]
                   [AND EXISTS (SELECT 1 FROM "ProductVariantOptionValue" l
                                JOIN "ProductOption" o       ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
                                JOIN "ProductOptionValue" ov ON ov."companyId" = l."companyId" AND ov."optionId" = l."optionId" AND ov.id = l."valueId"
                                WHERE l."companyId" = v."companyId" AND l."variantId" = v.id
                                  AND (o.name, ov.name) IN (($o1, $v1), ($o2, $v2), …))]  -- one EXISTS per entry, its spellings
                )]
)
SELECT ARRAY(SELECT id FROM matching ORDER BY <order> LIMIT $limit OFFSET $offset) AS ids,
       (SELECT count(*)::int FROM matching) AS total,
       EXISTS (SELECT 1 FROM "Product" WHERE "companyId" = $c) AS "storeHasProducts"
```

- Order: `"createdAt" DESC, id ASC`, or `name COLLATE "es-x-icu" ASC, id ASC`. These are the app list's orders, made deterministic by the tie-breaker.
- The variant filters live in **one** `EXISTS`, so they all apply to the same variant.
- Optional fragments are composed with `Prisma.sql` and `Prisma.join`, and every value is a parameter.
- The spelling pairs are written names compared with `=`. There is no SQL normalizer and no id list.
- Access: `Product_companyId_idx` for the store's products. Per product: `ProductVariant_companyId_productId_id_key` (prefix `companyId, productId`), `ProductStock_companyId_variantId_key`, the `ProductVariantOptionValue` PK prefix `(companyId, variantId)`, and the unique keys of `ProductOption` and `ProductOptionValue`.
- The global trigram GIN indexes do not lead with `companyId` and do not serve `unaccent(lower(…))`, so the design does not rely on them. The cost grows linearly with the store's own products and variants, never with other companies' rows.

**Page summaries** (one statement for the at most 20 ids):
- The app list's grouped shape without the `ProductPhoto` join, since no assistant field uses a photo.
- Plus `count(*) FILTER (WHERE active AND quantity = 0)`, `count(*) FILTER (WHERE active AND quantity BETWEEN 1 AND $threshold)`, the inactive count, and the SKU summary over active variants and over all variants.

**Matching variants** (one statement, only with variant filters):
- The same variant predicate, for `productId = ANY($pageIds)`.
- Each row carries its values in option order (`array_agg(ov.name ORDER BY o.position)`) and its saved-order key (`array_agg(ov.position ORDER BY o.position)`).
- `row_number() OVER (PARTITION BY productId ORDER BY key, id) <= 10` caps the rows, and `count(*) OVER (PARTITION BY productId)` gives the total per product.
- At most 20 × 100 variants enter the window.

**Detail:**
- `findSkuOwner`: `SELECT id, "productId" … WHERE "companyId" = $c AND sku IS NOT NULL AND lower(btrim(sku)) = $sku`, served by `ProductVariant_companyId_sku_normalized_key`.
- Then `productRepository.get` as it is.

Statements per call, including `set_config` of the snapshot:

| Call | Statements |
| --- | --- |
| Search | 2 (set_config, jit), storefront 1, then 1 to 4 for the search; at most 7 |
| Detail | 2, storefront 1, then 1 SKU lookup and 6 aggregate reads; at most 10 |

The count is constant in the number of products and variants: no N+1.

### 7.2 Rows read

Every raw row is parsed with a Zod schema in `infrastructure/product-search-repository.ts`: `vocabularyRowSchema`, `pageRowSchema`, `summaryRowSchema`, `matchingVariantRowSchema`, `skuOwnerRowSchema`. Decimals arrive as strings and are converted with `Prisma.Decimal`. `bigint` stock must be within the safe integer range, and the currency goes through `isCurrency`. A row that fails is `INVALID_STORED_DATA` with `invalid_stored_product_data` logged, never an empty result. Inside the snapshot, the adapters rethrow transaction failures, as `readProducts` does.

### 7.3 Performance check (T3)

**Seed** in `core_test`, through `product-search-fixtures.ts`:
- Store A: 2,000 products. Most have 6 active variants (Color × Talla). 50 products have 3 options with up to 30 colors, which brings the store vocabulary to about 200 spellings. One product has 100 variants. 10 % of variants are deactivated, and stock is spread over 0, 1–3 and higher.
- Store B: 20,000 products × 6 variants.

**How it is measured:**
- As `core_app` under RLS with the tenant set. Neither the owner role nor a superuser is used, because they bypass RLS.
- Inside the same budgeted snapshot, with `jit = off`.
- With `EXPLAIN (ANALYZE, BUFFERS, SETTINGS)` prefixed to the repository's own parameterized `Prisma.Sql` builders, which `product-search-repository.ts` exports for this purpose. Literal SQL in psql does not count.

**Statements measured on A and on B:**
1. The page with all filters: two `valores` entries, a price range, `stock: low` and `texto`.
2. The text-only page sorted by name.
3. Matching variants for a full page of 20 products.
4. The vocabulary, with its payload size in bytes and its Zod parse time.
5. The detail of the 100-variant product.

**Accepted when:**
- No plan node scans `ProductVariant`, `ProductStock` or `ProductVariantOptionValue` sequentially across companies.
- No plan reports JIT.
- On store A each statement runs under 150 ms on development hardware (initial value), well inside the 400 ms limit.
- On store B the timings are recorded, together with the store size at which the page statement would reach 400 ms, extrapolated linearly. That size is the limit after which the tools answer the reading-failure text. It goes in the pull request.

If store A fails, the implementer stops and escalates with the plans. No index is added without review.

## 8. Contracts between applications

None. Mobile is not touched, and `shared/contracts/products.ts` does not change (section 2). The MCP tool schemas are the contract with agents. They live in `products-tools.ts`, strict on input (an unknown field → «No existe el campo …») and strict on output.

## 9. Events and cross-feature integration

No event. Cross-feature capabilities, all consumed only by `src/composition/assistant-product-capabilities.ts`, never by `features/assistants`:

| Consumer | Capability | Provider |
| --- | --- | --- |
| `src/composition/assistant-product-capabilities.ts` | `products.readForAssistant(work)`, `products.searchForAssistant(request)`, `products.findForAssistant(reference)` and their types | `features/products/composition.ts` |
| same | `catalogStorefront.describe(companyId)`, `storeUrl` | `features/catalog/composition.ts`, `features/catalog/index.ts` |
| `features/assistants` | `ProductToolsDependencies` (its own ports), implemented by the composition | `src/composition/assistant-product-capabilities.ts` |
| MCP 4/4 (later) | `lowStockThreshold`, `stockLevelOf`, `VariantStockFilter` | `features/products/domain/stock-level.ts` |

## 10. Mobile

No change.

## 11. Transactions and concurrency

Reads only. «Reads only» is a property of the code: no product tool path issues a write, and the snapshot is not declared `READ ONLY`, because `TransactionOptions` has no such option and this design does not add one.

Each tool call:

1. Takes one of 3 per-process slots. With none free, it answers the reading-failure text immediately (`READS_BUSY`).
2. Opens one `withinTransaction` with `isolationLevel: "RepeatableRead"`, `maxWait: 1000`, `timeout: 5000` and `statementTimeoutMs: 400`. The first statement sets the tenant and the statement timeout in one round trip, and the second sets `jit` off.
3. Reads the storefront, then the search (vocabulary, page ids and total, summaries, matching variants) or the detail (SKU owner, aggregate), all in the same snapshot. The total, the page, the vocabulary and the catalog line therefore never disagree with a concurrent save.
4. Commits, which releases the pool connection.

Budget:
- At most 10 statements × 400 ms = 4,000 ms of server time, under the 5,000 ms Prisma timer, with 1,000 ms left for round trips.
- A unit test of `assistantReadBudget` asserts `maxStatements × statementTimeoutMs + 1000 ≤ timeout`. A later change that adds a statement must keep it true.

Failures:

| Situation | Effect | `errorCode` | Agent receives |
| --- | --- | --- | --- |
| Pool saturated beyond `maxWait` | No statement starts; Prisma throws P2028 | `TRANSACTION_TIMEOUT` | Reading-failure text |
| One statement exceeds 400 ms | PostgreSQL cancels it (`57014`) and the transaction rolls back | `STATEMENT_TIMEOUT` | Reading-failure text |
| The Prisma timer fires first (only possible when round trips exceed the 1,000 ms margin) | Prisma rolls back; the statement in flight is stopped by its own 400 ms limit at the latest | `TRANSACTION_TIMEOUT` | Reading-failure text |
| 4th call while 3 are in flight | No transaction | `READS_BUSY` | Reading-failure text |

No statement outlives the call by more than 400 ms. A call holds a pool connection for at most 5 s, and product calls hold at most 3 of the pool's 10 connections, so the web app and the order tools always keep 7.

Writes outside the tools:
- The `oauthClient.scopes` alignment is one idempotent conditional `UPDATE`. Two concurrent `/authorize` requests write the same value, and the second writes nothing.
- `revokePriorGrant` reuses `revokeClientGrant`, which is idempotent.
- Ending a connection reuses `endConnection` unchanged: delete, then best-effort revocation.

## 12. Code organization

| File | Change | Task |
| --- | --- | --- |
| `apps/core/src/features/assistants/domain/scopes.ts` | `products:read` literal | T1 |
| `…/assistants/domain/assistant-connection.ts` (+ test) | `ConnectionEndReason`, `connectionEndReason`, `requiredScopes` parameter of `isConnectionActive` | T1 |
| `…/assistants/application/resolve-assistant-access.ts` (+ test), `list-assistant-connections.ts`, `connections.test.ts` | Reason from `connectionEndReason`, `consent_outdated` refusal, non-empty scope intersection, `assistantScopes` passed | T1 |
| `…/assistants/application/authorize-assistant.ts` (+ test), `assistant-fixtures.ts` | `[...assistantScopes]` | T1 |
| `…/assistants/infrastructure/connection-access-repository.ts` | `endConnection` reason type | T1 |
| `…/assistants/infrastructure/connection-repository.ts` | Passes `assistantScopes`; `outcome` field on `assistant_connection_created` | T1 |
| `…/assistants/infrastructure/oauth-hooks.ts` (+ test), `…/assistants/auth-hooks.ts` | `alignClientScopes`, `revokePriorGrant` and their adapters | T1 |
| `…/assistants/infrastructure/*.integration.test.ts`, `presentation/assistant-lifecycle.integration.test.ts`, `presentation/oauth-metadata-routes.integration.test.ts`, `presentation/mcp-routes.integration.test.ts` | New scope string, outdated connections, rows with both scopes | T1 |
| `apps/core/app/locales.ts`, `app/routes/assistant-authorize.tsx` (+ test), `app/routes/assistant-settings.test.tsx`, `tests/e2e/assistants.spec.ts` | Consent and settings texts of the product draft (es, pt) and two new «Podrá ver» lines | T1 |
| `…/assistants/presentation/server-instructions.ts` (+ new test) | Language rule | T2 |
| `…/assistants/presentation/tools/orders-texts.ts` | The «tal cual» sentence | T2 |
| `…/assistants/presentation/tool-registry.ts` (+ new `tool-registry.test.ts`) | Language checks in `checkToolModules` | T2, then T5 |
| `…/products/domain/stock-level.ts` (+ test), `product-search.ts` (+ test) | New | T3 |
| `…/products/application/search-for-assistant.ts` (+ test), `find-for-assistant.ts` (+ test) | New | T3 |
| `…/products/infrastructure/product-search-repository.ts` (+ integration test), `assistant-read.ts` (+ test), `statement-timeout.ts`, `text-candidates.ts`, `product-search-fixtures.ts` | New queries, row schemas, the budgeted snapshot, the moved detector, the performance seed | T3 |
| `…/products/composition.ts` | `readForAssistant`, `searchForAssistant`, `findForAssistant` in `products` | T3 |
| `…/catalog/infrastructure/catalog-settings-repository.ts` (+ integration test), `…/catalog/composition.ts` | `readStorefrontState`, `catalogStorefront.describe` | T4 |
| `…/assistants/presentation/tool-module.ts`, `tool-registry.ts`, `tools/orders-tools.ts`, `presentation/mcp-routes.integration.test.ts` (fixture module) | `readFailureMessage` per module | T5 |
| `…/assistants/domain/product-projection.ts` (+ test) | New, with its `Projectable*` types | T5 |
| `…/assistants/presentation/tools/products-tools.ts` (+ test), `products-texts.ts` | New module and ports | T5 |
| `apps/core/src/composition/assistant-product-capabilities.ts` (+ test) | New mapping, 3-slot limit | T5 |
| `apps/core/src/composition/assistant-tools.ts`, `assistant-tools.test.ts` | Product module entry; six tools; fixture `readFailureMessage` | T5 |
| `…/assistants/presentation/products-tools.integration.test.ts` | New, MCP client against a real database | T5 |

`docs/assistants.md` and `docs/products.md` are updated at promotion, when the branch merges (Documentation skill), not by the tasks.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `assistant_tool_called` | info | `tool-registry.ts` (unchanged) | `["companyId", "connectionId", "tool", "outcome", "durationMs"]`; `tool` is `buscar_productos` or `ver_producto` |
| `assistant_tool_failed` | error | `assistant-product-capabilities.ts`, `tool-registry.ts` | `["companyId", "connectionId", "tool", "errorCode"]`; `errorCode` ∈ `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA`, `STATEMENT_TIMEOUT`, `TRANSACTION_TIMEOUT`, `READS_BUSY` |
| `assistant_access_refused` | info | `mcp-routes.ts` (unchanged) | existing, with `reason: "consent_outdated"` |
| `assistant_connection_ended` | info | `connection-access-repository.ts` | existing, with `reason: "consent_outdated"`; counts the endings of the release |
| `assistant_connection_created` | info | `connection-repository.ts` | existing, plus `outcome` ∈ `inserted`, `reactivated`; counts the re-authorizations of the release |
| `assistant_client_scopes_aligned` | info | `auth-hooks.ts` adapter, only on a real write | `["oauthClientId"]` |
| `assistant_authorize_hook_failed` | error | existing | existing; `errorCode` of the alignment or of the revocation |
| `product_search_failed` | error | `assistant-read.ts` | `["companyId", "operation", "errorCode", "durationMs"]`; `operation` ∈ `search`, `detail`; `errorCode` ∈ `PERSISTENCE_UNAVAILABLE`, `STATEMENT_TIMEOUT`, `TRANSACTION_TIMEOUT` |
| `invalid_stored_product_data` | error | existing | existing fields, `stage` ∈ `vocabulary`, `page`, `summaries`, `matching_variants`, `sku_owner` |
| `unable_to_read_catalog` | error | `catalog-settings-repository.ts` | existing, `operation: "read_storefront"` |

Never logged: tool inputs and outputs, search text, values, SKUs, prices, product names, the store subdomain.

## 14. Tests

### Unit (core, Vitest)

`features/products/domain/stock-level.test.ts`
- `test("classifies 0 as sold out, 1 to 3 as low and 4 as available")`
- `test("counts low variants as in stock for the in-stock filter")`

`features/products/domain/product-search.test.ts`
- `test("matches «azul», « Azul » and «AZÚL» to the same key and never «Azul claro»")`
- `test("refuses cents that are negative, fractional or above the stored maximum")`
- `test("refuses a reversed price range")`
- `test("refuses a variant filter together with en_catalogo no")`
- `test("lists options alphabetically and values in saved order, newest product first, so sizes read S, M, L")`
- `test("lists a value written «azul» and «Azul» once, as written in the newest product, keeping both spellings")`
- `test("resolves «M» to the spellings of every option that holds it")`
- `test("resolves «Talla: M» only to the spellings under Talla")`
- `test("rejects «Color: M» as a value that exists only under another option")`
- `test("rejects «Material: Algodón» as an unknown option")`
- `test("resolves «3:4» as a whole value when 3 is not an option")`
- `test("rejects any value in a store whose products have no options")`

`features/products/application/search-for-assistant.test.ts`
- `test("does not read the vocabulary when no value is sent")`
- `test("answers the value rejection without searching the page")`
- `test("passes the low-stock threshold and a cap of 10 matching variants to the page query")`
- `test("returns a persistence failure, never an empty page")`

`features/products/application/find-for-assistant.test.ts`
- `test("opens the product of a SKU written «pol-m-az » and marks that variant as searched")`
- `test("returns the variants in saved order")`
- `test("answers null for an unknown SKU and for an unknown product")`

`features/products/infrastructure/assistant-read.test.ts`
- `test("keeps the worst-case statements of a call inside the transaction timer with a second to spare")`
- `test("maps a statement timeout to STATEMENT_TIMEOUT and a Prisma P2028 to TRANSACTION_TIMEOUT")`

`features/assistants/domain/assistant-connection.test.ts`
- `test("ends a connection that lacks a required data scope as consent_outdated")`
- `test("ends a two-scope connection when a third scope is required")`
- `test("reports a password change before an outdated consent and an outdated consent before inactivity")`

`features/assistants/application/resolve-assistant-access.test.ts`
- `test("ends an orders-only connection on its next call and refuses it as consent_outdated")`
- `test("exposes only the scopes held by both the token and the connection")`

`features/assistants/application/authorize-assistant.test.ts`
- `test("saves the connection with the orders and products scopes")`

`features/assistants/infrastructure/oauth-hooks.test.ts`
- `test("aligns the client's scopes before the session is read on authorize")`
- `test("revokes the prior grant instead of only the consent when no active connection exists")`
- `test("answers 503 when the client scopes cannot be aligned or the prior grant cannot be revoked")`

`features/assistants/presentation/tool-registry.test.ts`
- `test("reports a module whose instructions say to answer in Spanish")` (T2)
- `test("reports a description that says to quote a reason «tal cual»")` (T2)
- `test("answers a product tool's thrown read with the products reading-failure text")` (T5)
- `test("answers an order tool's invalid output with the orders reading-failure text")` (T5)

`features/assistants/presentation/server-instructions.test.ts`
- `test("tells the agent to answer in the owner's language and to keep store data unchanged")`

`features/assistants/domain/product-projection.test.ts`
- `test("summarizes S = 0, M = 2, L = 10 as «Stock: 12 · 1 agotada, 1 con stock bajo»")`
- `test("summarizes six sizes at 1 unit as «Stock: 6 · 6 con stock bajo»")`
- `test("shows «Stock: 0 · Agotado» only when every active variant is at 0")`
- `test("shows the level of a product with one variant")`
- `test("gives a product without active variants no price, no stock line, no level and no customer link")`
- `test("never includes a purchase price in a search item")`
- `test("adds «hay más: pide la página 2» on page 1 of 45 and no more line on page 3")` (acceptance 7)
- `test("cuts a 1,500-character description at 1,000 with «… (la descripción continúa en Yoyos)»")`
- `test("shows «Sin precio de compra» when it was never entered and «S/ 0.00» when it was entered as 0")`
- `test("lists 10 matching variants and «y 4 variantes más: usa Ver producto»")`
- `test("cuts the value list at 100 with «y 30 valores más»")`
- `test("answers «No hay productos con esos filtros: precio hasta S/ 30.00.» with the catalog line")` (acceptance 2)
- `test("writes every applied filter in an empty answer")`

`features/assistants/presentation/tools/products-tools.test.ts`
- `test("maps «stock bajo», «sí», 39.9 and «Color: Azul» to the search request")`
- `test("refuses more than three values with the field and the remedy")`
- `test("refuses ver_producto with both producto and sku, and with neither")`
- `test("answers a non-UUID product identifier like an unknown product without reading")`
- `test("answers «Tu tienda todavía no tiene productos.» with the catalog line in an empty store")`
- `test("says in the Buscar productos description that Yoyos has no categories, with «polo» and «casac» written literally")` (acceptance 10)
- `test("answers a product of 60 variants with two-byte text at maximum lengths complete")`

`src/composition/assistant-product-capabilities.test.ts`
- `test("gives the customer link only when the catalog is published, the product is in it and its currency is the store's")`
- `test("answers the reading-failure text at once when three product reads are in flight")`
- `test("logs one assistant_tool_failed with the error code of a failed read")`

`src/composition/assistant-tools.test.ts` (static validator)
- `test("lists the six tools, all read only, for a connection with both scopes")`
- `test("keeps a search page of 20 products at maximum ASCII lengths within 24 KB")`
- `test("keeps a search page of 20 products with 3 matching variants each at maximum ASCII lengths within 24 KB")`
- `test("keeps a product of 60 variants with a 1,000-character description at maximum ASCII lengths within 24 KB")`
- `test("answers a product of 100 variants at maximum lengths complete")`

`app/routes/assistant-authorize.test.tsx`
- `test("lists the orders and products lines in Spanish and Portuguese")` (acceptance 19)

`app/routes/assistant-settings.test.tsx`
- `test("shows the intro and the Desconectar description that name orders and products, in Spanish and Portuguese")` (acceptance 19)

### Integration (core, real database)

`features/products/infrastructure/product-search-repository.integration.test.ts`
- `test("returns both products for «azul» and «m» with their M / Azul variant")` (acceptance 1)
- `test("returns only the product whose same active variant meets every variant filter")` (acceptance 1, 6)
- `test("matches the price range on the sale price of the active variant, both ends inclusive")` (acceptance 2)
- `test("returns a product for agotado, stock bajo and con stock through different variants")` (acceptance 3, 4)
- `test("never matches a deactivated variant")`
- `test("returns a product without active variants for en_catalogo no and not for sí")` (acceptance 5)
- `test("matches text on the name or any SKU ignoring case and accents, as one phrase")` (acceptance 10)
- `test("pages 45 products as 20, 20 and 5 with total 45, newest first and by name")` (acceptance 7)
- `test("builds the vocabulary from active variants only, without ids")` (acceptance 8)
- `test("finds the variant and product of a SKU in one lookup")` (acceptance 14)
- `test("never reads another store's products, values or SKUs")` (acceptance 20)
- `test("reports stored data that fails its schema as invalid stored data")`
- `test("answers STATEMENT_TIMEOUT when a statement exceeds its limit and leaves no statement running")`

`features/catalog/infrastructure/catalog-settings-repository.integration.test.ts`
- `test("describes a published, a hidden and a never-linked catalog with the store currency")`
- `test("reads the storefront inside the caller's snapshot without a transaction of its own")`

`features/assistants/presentation/products-tools.integration.test.ts`
- `test("answers buscar_productos through the MCP server with the catalog line and customer links")` (acceptance 12)
- `test("answers ver_producto by SKU and by identifier, and another store's product as not found")` (acceptance 14)
- `test("counts product calls in the store limit shared with order tools")` (acceptance 21)
- `test("leaves every product, price and stock unchanged after any sequence of calls")` (acceptance 23)

`features/assistants/presentation/assistant-lifecycle.integration.test.ts`
- `test("hides an orders-only connection from the list, ends it on its next call and shows the screen again")` (acceptance 18)
- `test("re-authorizes an agent registered before products with its own client and lists six tools")` (acceptance 18; six tools after T5)
- `test("revokes the old grant's refresh tokens when an orders-only connection is re-authorized before its next call")`

`features/assistants/presentation/oauth-metadata-routes.integration.test.ts`
- `test("advertises orders:read, products:read and offline_access")`

### Web E2E (happy path)

`tests/e2e/assistants.spec.ts`
- `test("connects an agent on a screen that lists orders and products")` (acceptance 19, Spanish route)

### Pending manual checks

- Claude and ChatGPT against a preview: «¿Tienes polos azules en M?», «¿Qué se me está acabando?», «¿Cuánto me costó la casaca negra?» (the purchase price only from **Ver producto**), «¿qué categorías tengo?».
- Portuguese: «Quais camisetas azuis eu tenho?» and «O que eu despacho hoje?» answer in Portuguese with store data unchanged (acceptance 22).
- An agent connected before the release re-authorizes by itself after its first refused call. The founder's own connections must be connected again.

## 15. Limits and checks during implementation

- **Budget arithmetic.** The validator samples are the proof:
  - The 24 KB cases are proved for ASCII text, with UTF-8 bytes as `Buffer.byteLength` counts them.
  - A search item is about 1.05 KB with a 100-character name, a 40-character SKU, three matching variants (50-character combination, 40-character SKU) and both links, so 20 items are about 21 KB.
  - A **Ver producto** variant is about 0.29 KB with a 50-character combination and a 100-character SKU. 60 variants plus a 1,000-character description and three options of 30 values come to about 22.3 KB.
  - With two-byte text (accents, «ñ») at the same lengths, the 60-variant case reaches about 28 KB. It is answered complete, as the product draft requires for large answers, and a test covers it.
  - If an ASCII sample exceeds 24 KB, the implementer escalates instead of cutting another field.
- **Currency** (T3, defined outcome): no server guard keeps a product's currency equal to the store's. `createProductRequestSchema.currency` comes from the client, and the web form sends the store currency. T3 records this in the pull request; it neither fixes it nor escalates it. Such a product shows «En el catálogo» without a customer link, as the public catalog would not list it. The guard is a deferred item of products.
- **Plugin** (T1): verify on 1.7.14 that `hooks.before` on `/oauth2/authorize` runs before the client is read and before the scope check, and that a client whose `scopes` were updated in place accepts the new scope. The T1 integration test covers this.
- **Collation**: `es-x-icu` must exist in the test and production databases, as the app list already requires.
- **`unaccent`**: the public catalog's extension. `unaccent(lower(sku))` on a null SKU is null and does not match.
- **Pool**: the 3-slot limit assumes the default pool of 10. If `DATABASE_POOL_MAX` is raised, the limit stays 3. That is deliberate: product reads never take more connections because the pool grew.
- Not designed: price or stock sorting, description search, photos, a configurable threshold, margins.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1 (parallel):  T1 Consent, scope and outdated connections        (assistants domain/application/infrastructure, consent texts)
                    T2 Language rule                                  (server-instructions, orders-texts, tool-registry checks)
                    T3 Product search and detail reads                (features/products)
                    T4 Storefront state                               (features/catalog)
Wave 2:             T5 Product tool module and per-module failure text (depends on T1, T2, T3, T4)
Final verification  (after T5)
```

Files per task are those of section 12. Tasks of the same wave share no file. `tool-registry.ts` is edited by T2 (wave 1) and then T5 (wave 2). `presentation/mcp-routes.integration.test.ts` is edited by T1 (wave 1, connection rows) and then T5 (wave 2, fixture module). T5 starts from the integration branch with wave 1 merged.

### T1. Consent, scope and outdated connections

**Scope:**
- `products:read` in `assistantScopes`.
- `connectionEndReason` with `requiredScopes`, and the scope rule in `isConnectionActive` and in its four callers.
- `consent_outdated` in `resolveAssistantAccess` and `endConnection`.
- `authorizeAssistant` saving every scope.
- `alignClientScopes` (set comparison) and `revokePriorGrant` in the `/authorize` hook.
- The `outcome` field of `assistant_connection_created`.
- The consent and settings texts of the product draft in `app/locales.ts` (es, pt), and the two new «Podrá ver» lines in `assistant-authorize.tsx`.
- Updated scope strings in the existing assistant tests, including `mcp-routes.integration.test.ts` and `connections.test.ts`.
- The E2E text.

**Out of scope:** any tool, the server instructions, `tool-registry.ts`, `tool-module.ts`, `features/products`, `features/catalog`.

**Acceptance criteria:**
1. A connection stored with `scopes = {orders:read}` and used yesterday is not listed in «Asistentes de IA». Its next `POST /mcp` answers `401` and logs `assistant_access_refused` with `consent_outdated`. Its row is gone and its tokens are revoked.
2. That agent's `/authorize` with its original client, not signed in, reaches the login page (no `invalid_scope`). Once signed in, it shows the authorization screen titled «ChatGPT quiere leer los pedidos y productos de Tienda Rosa». **Permitir acceso** leaves one row with both scopes and logs `assistant_connection_created` with `outcome: "reactivated"`.
3. When the owner re-authorizes before the old agent calls again, the old refresh token is refused at the token endpoint.
4. A new registration and authorization yield tokens with `orders:read products:read offline_access`, and the metadata advertises them.
5. `/pt-BR/assistants/authorize` and the Portuguese settings show the Portuguese texts of the product draft's Screens table.

**Tests:** the T1 titles of section 14: assistant-connection, resolve-assistant-access, authorize-assistant, oauth-hooks, assistant-authorize and assistant-settings routes, assistant-lifecycle, oauth-metadata-routes and E2E. The existing assistant suites stay green.

**Depends on:** nothing.

### T2. Language rule

**Scope:** the `generalInstructions` and `orderToolsInstructions` texts, and the language violations in `checkToolModules`.

**Out of scope:** scopes, consent texts, `ToolModule`, `render`, product code.

**Acceptance criteria:**
1. The server instructions of a connection contain the owner's-language rule and no «en español», and `checkToolModules(toolModules)` is empty.
2. A module whose description says «responde en español», or whose instructions say «cítalo tal cual», is reported by `checkToolModules`.

**Tests:** the T2 titles of `tool-registry.test.ts` and the `server-instructions` title of section 14. The existing validator stays green.

**Depends on:** nothing.

### T3. Product search and detail reads

**Scope:**
- `stock-level.ts`, `product-search.ts`, `search-for-assistant.ts`, `find-for-assistant.ts`.
- `assistant-read.ts` with `assistantReadBudget` and the error mapping, and `statement-timeout.ts` (moved from `text-candidates.ts`).
- `product-search-repository.ts` with its row schemas and exported SQL builders.
- `products.readForAssistant`, `products.searchForAssistant` and `products.findForAssistant` in `composition.ts`.
- The performance seed and the check of section 7.3, and the currency finding of section 15 for the pull request.

**Out of scope:** Spanish texts, MCP schemas, the app product list and its contract, catalog settings, `shared/infrastructure/persistance.ts`.

**Acceptance criteria:**
1. With the product draft's store (Polo básico M / Azul S/ 39.90 stock 2, L / Rojo S/ 45.00 stock 10; Casaca M / Azul S/ 120.00 stock 0), values «azul» and «m» return both products with M / Azul. Adding `in_stock` returns only Polo básico.
2. `priceFromCents` 4000 and `priceToCents` 13000 return Polo básico through L / Rojo and Casaca through M / Azul.
3. A store with values Azul, Azul claro, Negro, Rojo and S, M, L rejects «Celeste» with a vocabulary whose sizes read S, M, L. «Verde», held only by deactivated variants, is rejected. «3:4» held by a variant is found.
4. 45 matching products page as 20, 20 and 5 with total 45.
5. `findForAssistant({ by: "sku", sku: "pol-m-az " })` opens Polo básico with M / Azul as the searched variant.
6. A statement forced past 400 ms answers `STATEMENT_TIMEOUT` and logs `product_search_failed`. `pg_stat_activity` then shows no statement of that call still running.
7. The plans and timings of section 7.3 meet the criteria and are recorded for the pull request.

**Tests:** the products unit and integration titles of section 14, including `assistant-read.test.ts`. The existing `text-candidates` tests stay green.

**Depends on:** nothing.

### T4. Storefront state

**Scope:** `readStorefrontState` in `catalog-settings-repository.ts` and `catalogStorefront.describe` in `catalog/composition.ts`, joining an active transaction and rethrowing transaction failures.

**Out of scope:** catalog settings screens, `catalogSettings.get`, products, assistants.

**Acceptance criteria:**
1. A published store, a hidden one with a subdomain and one never linked are described with their kind, subdomain and `PEN`/`BRL` currency.
2. Called inside a snapshot, `describe` issues exactly one statement and opens no transaction of its own.

**Tests:** the catalog-settings-repository integration titles of section 14.

**Depends on:** nothing.

### T5. Product tool module and per-module failure text

**Scope:**
- `ToolModule.readFailureMessage` and its use in `render`; the order module sets it, and the fixture modules of `assistant-tools.test.ts` and `mcp-routes.integration.test.ts` get it.
- `product-projection.ts` with its `Projectable*` types.
- `products-tools.ts` with its ports, and `products-texts.ts` with the product draft's descriptions: no categories, «polo» and «casac» written literally, the purchase price is not for customers and no margins, stock is the current count, mention a hidden catalog once. Also the inputs, outputs, messages and ASCII sample outputs at maximum lengths.
- `assistant-product-capabilities.ts` with the mapping, the customer link rule and the 3-slot limit.
- The entry in `assistant-tools.ts`.
- The validator and MCP integration tests.

**Out of scope:** scopes, access, the language checks, the order module's instructions, the `features/products` queries and budget, the catalog read.

**Acceptance criteria:**
1. A connection with both scopes lists six tools, and the validator passes with the budget cases of section 14.
2. Acceptance criteria 1–17, 20, 21 and 23 of the product draft pass, through the MCP client in `products-tools.integration.test.ts` or through the unit tests named in section 14.
3. A read failure, a timeout or a 4th concurrent call answers «No pudimos leer tus productos en este momento. Inténtalo de nuevo en unos segundos.» and logs `assistant_tool_failed` once, with its `errorCode`.
4. `grep -r "features/products\|features/catalog" apps/core/src/features/assistants` finds nothing.

**Tests:** the T5 titles of section 14: tool-registry failure text, product-projection, products-tools, assistant-product-capabilities, the validator, and the products-tools integration titles. Also the six-tool lifecycle title.

**Depends on:** T1 (the `products:read` literal), T2 (the language checks, `tool-registry.ts`), T3 (the composed operations), T4 (`describe`).

### Final verification

- `scripts/ci.sh` is green on the integration branch.
- The manual checks of section 14 pass with Claude and ChatGPT against a preview, in Spanish and Portuguese.
- T3's performance plans and the currency finding are in the pull request.
- The pull request warns that existing connections, the founder's included, must be connected again.

## 17. Questions decided by the review gate

Answered on 31/10/2026 by round 1 of the architecture review gate of the implement-task skill. The design and performance reviewers agreed, and the coordinator consolidated their answers. The founder confirms them in the pull request.

| Question | Answer | Decided by | Reason | Discarded |
| --- | --- | --- | --- | --- |
| 1. Ending connections at release: does the rule apply only to `products:read` or to every data scope Yoyos adds later? | (1) Every current data scope. A connection must hold every scope of `assistantScopes`, passed explicitly as `requiredScopes` to `connectionEndReason`. | Reviewers (design and performance), consolidated by the coordinator | It errs toward the consent rule: a new category is never granted silently. MCP 3/4 and 4/4 get the release behavior by adding their literal. Passing the scopes explicitly makes a later change to the predicate visible in review. It adds no lookup to the call path. | (2) Only `products:read`: each later task must edit the predicate, and forgetting to do so would leave older connections without the new tools and without ever showing their consent. |

Deferred with real risk, for the founder to decide whether to create a Todoist task:
- Margins have no owner task (product draft).
- No server guard keeps product currency equal to store currency (section 15).

Decided unless objected:
- Old connections are ended lazily through `connectionEndReason` with `requiredScopes = assistantScopes`. They are hidden from the list at once, and deleted and revoked on their next call. No data migration, since there is no production data.
- At `/authorize` without an active connection, the hook revokes the prior grant (tokens and consent), so old refresh tokens never survive a reactivation.
- The `/authorize` hook aligns each registered client's stored scopes with the current set before the session read. The plugin checks scope before session, and the write is an idempotent no-op once aligned, comparing sets. It is a hook rather than a migration because every later scope needs the same alignment.
- `features/assistants` imports no products or catalog file. It declares its own ports and `Projectable*` types, and `src/composition` maps them. Raw input is parsed inside `features/products`.
- The search filters stay internal to `features/products` (`AssistantProductSearch`). `productListQuerySchema` does not change until the app list uses them.
- `lowStockThreshold = 3` is a constant in `products/domain/stock-level.ts`, passed to SQL as a parameter. Products computes the level, and MCP 4/4 reuses it.
- Text search ignores accents as well as case (`unaccent(lower(…))`), on the name and any SKU, so it is more lenient than the app list's ILIKE.
- Value matching normalizes in TypeScript and filters by the written spellings in SQL. The vocabulary carries names only, no ids.
- «Opción: valor» splits only when the left side is a store option, so values such as «3:4» stay reachable.
- No new index. Access leads with `companyId` on the existing indexes, checked with EXPLAIN as `core_app` under RLS on a 2,000-product store (under 150 ms per statement, initial value) and recorded on a 20,000-product store.
- Each tool call runs in one snapshot, together with the storefront read, with `maxWait` 1,000 ms, a 5,000 ms timer, 400 ms per statement and `jit` off: fixed constants with a unit test of their sum.
- At most 3 product reads are in flight per process; a 4th call answers the reading-failure text at once.
- Output maxima as in MCP 1/4: names 100, combinations 50, SKUs 40 in search lists. **Ver producto** shows SKUs and option values whole. The 24 KB proof covers ASCII, and two-byte text answers complete.
- The customer link also requires the product currency to equal the store currency, the public catalog's own filter.
- There is a reading-failure text per tool module, and the validator refuses «en español» and «tal cual» in any module's texts.
- `assistant_connection_created` carries `outcome` (`inserted` or `reactivated`), so the release cutover can be counted.
