# Products in AI assistants: technical design

**Status:** draft with open questions. Based on [`docs/drafts/mcp-products.md`](mcp-products.md) (product definition closed by the review gate on 31/10/2026). Base: `jorgeluis594/mcp-2-4-productos-con-filtros-nuevos-en` at `279b82b4`, on top of MCP 1/4 (`eba41e1a`, #311). Todoist 6hrqGV59mx8H4p7V.

## 1. Technical goal

The MCP server of MCP 1/4 gains a second read-only tool module, `products:read`, with **Buscar productos** (`buscar_productos`) and **Ver producto** (`ver_producto`). Every new authorization grants `orders:read products:read offline_access`; a connection that does not hold every current data scope is ended the next time it is used, listed or re-authorized, and its agent re-authorizes with its own client. The server instructions tell the agent to answer in the owner's language for every module. The tools read through two new composed operations of `features/products` (a filtered, paginated search and a read by id or SKU) and one of `features/catalog` (the storefront state), with a constant number of statements per call and company-leading index access.

```text
agent ──POST /mcp──▶ mcp-routes ─▶ resolveAssistantAccess (unchanged path; ends connections missing a scope)
                                  └▶ tool-registry ─▶ answerToolCall ─▶ products-tools.ts
                                                                         ├─ catalogStorefront.describe(companyId)    1 statement
                                                                         ├─ products.searchForAssistant(criteria)    1–4 statements, one snapshot
                                                                         └─ products.findForAssistant(reference)     1–8 statements, one snapshot
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Tool module | `createProductToolsModule(deps)` in `features/assistants/presentation/tools/products-tools.ts`, scope `products:read`, `access: "read"`, its own instructions paragraph and reading-failure text, registered in `src/composition/assistant-tools.ts` after the order module. Nothing in the server, transport, limiter or access path changes for it. |
| Scope | `products:read` is added to `assistantScopes`; `grantedOAuthScope` becomes `orders:read products:read offline_access`. Every connection and token gets both data scopes; there is no per-category choice. |
| Ending connections authorized before this task | No migration. `isConnectionActive` also requires the connection's `scopes` to contain every element of `assistantScopes`. The four places that already use that predicate (tool call, list, `/authorize` screen guarantee, `saveConnection`) then treat an orders-only connection exactly as an inactive one: hidden from «Asistentes de IA», ended (row deleted, grant revoked) on its next call with reason `consent_outdated`, its stored consent dropped on the next `/authorize`, and its row reactivated with the new scopes when the owner allows again. See [question 1](#17-open-items-and-questions). |
| Registered clients | Before this task every dynamic client was registered with `scopes = {orders:read, offline_access}`, and the plugin refuses an `/authorize` whose scope is not a subset of the client's (`invalid_scope`). The `/authorize` hook therefore aligns the client's stored scopes with `oauthScopes` (one conditional `UPDATE` on the global `oauthClient` row, only when they differ) before the plugin reads the client. It runs only on `/authorize`, never on `/mcp`. |
| Language | `generalInstructions` says to answer in the owner's language and to keep store data unchanged; the order paragraph's «cítalo tal cual» becomes «transmite su sentido sin convertirlo en una promesa, en el idioma del dueño». `checkToolModules` refuses any instruction, title or description that says to answer in Spanish or to quote «tal cual». Tool names, inputs and messages stay in Spanish. |
| Reading-failure text | Per module: `ToolModule.readFailureMessage`. The registry uses it for an output that fails its schema and for a thrown run, instead of the order text it uses today. |
| Product reads | Through composed operations of `features/products` (`products.searchForAssistant`, `products.findForAssistant`), never REST, never another feature's repository. |
| Search contract | Internal to `features/products`: `ProductSearchCriteria` in `application/search-for-assistant.ts`. `shared/contracts/products.ts` (`productListQuerySchema`) does not change. Reason: no second application consumes the filters yet (guide rule 5.2), and the app list's `stock=sold_out` is a product-level rule («every active variant at 0») while the assistant's `agotado` is a variant-level one («at least one active variant at 0»); merging them now would change the app list. When the app list gets the filters, its contract adds fields mapped onto `ProductSearchCriteria` and its handler calls the same use case: the meeting point is the criteria type, not the HTTP schema. |
| Stock levels | `features/products/domain/stock-level.ts`: `lowStockThreshold = 3` (one constant, the same for every store, changed only by Yoyos; MCP 4/4 owns later changes), `stockLevelOf(quantity)` and the per-variant filter. SQL receives the threshold as a parameter, never as a literal. Not an environment variable: it is a business rule, not an operational value. |
| «En el catálogo» | At least one variant with `status = 'active'` (`Product.status` is always `active`). Computed in SQL with the same `EXISTS` as the public catalog. |
| Customer link | `storeUrl(subdomain, "/productos/<id>")` (`storeUrl` of `features/catalog`, the path the public catalog and the legacy redirect already use), only when the catalog is published, the product is in the catalog and the product currency is the store currency (the public catalog's own filter, so the link never leads to a missing page). |
| Text match | `unaccent(lower(x)) LIKE unaccent(lower('%texto%'))` on `Product.name` and on any `ProductVariant.sku` (active or not), with `%`, `_` and `\` escaped, like the public catalog search. One phrase, no word split. |
| Value match | Exact on the whole name after `matchKeyOf` (NFD, combining marks removed, lower case, trimmed). Done in TypeScript over the store's vocabulary, which yields the matching `ProductOptionValue` ids; SQL filters by ids. There is one normalizer, never a second one in SQL. |
| Output lengths | As in MCP 1/4: product names shortened to 100 characters and combinations to 50 (`…` at the end); in **Buscar productos** SKUs are shortened to 40 characters; **Ver producto** shows SKUs and option values whole. These maxima are what makes the product draft's 24 KB cases hold (section 15). |
| Indexes | No new index and no migration. Every access is company-leading on existing B-tree indexes (section 7); the plan is checked on a seeded store during T3. |
| Statement timeout | `PRODUCT_SEARCH_STATEMENT_TIMEOUT_MS`, initial value 2000, adjustable, on the search and detail snapshots. A timeout answers the reading-failure text. |
| Response budget | 24 KB per answer as in MCP 1/4; the static validator checks the four cases of section 14. A larger answer is sent complete. |
| Deferred | Margins (no owner task, flagged in the product draft). Sorting by price or stock. A configurable threshold (MCP 4/4). The app list filters. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Tool module contract | `features/assistants/presentation/tool-module.ts` | `{ scope, access: "read", instructions, tools }`; no reading-failure text per module |
| Registry and validator | `presentation/tool-registry.ts`, `src/composition/assistant-tools.test.ts` | `readFailureMessage` is the order text for every module; `checkToolModules` checks names, titles, strict input, annotations, samples and 24 KB |
| Server instructions | `presentation/server-instructions.ts` | «Responde siempre en español…» in `generalInstructions` |
| Order paragraph | `presentation/tools/orders-texts.ts` (`orderToolsInstructions`) | Contains «cítalo tal cual» |
| Scopes | `domain/scopes.ts` | `assistantScopes = ["orders:read"]`; `oauthScopes`, `grantedOAuthScope` derived; used by `auth.ts`, metadata, token verifier, connection rows |
| Connection activity | `domain/assistant-connection.ts` `isConnectionActive` | Inactivity window and password change only; used by `resolve-assistant-access.ts`, `list-assistant-connections.ts`, `auth-hooks.ts` (`createHasActiveConnection`), `connection-repository.ts` (`saveConnection`) |
| Access per call | `application/resolve-assistant-access.ts` | Ends inactive or password-changed connections through `endConnection(connection, reason)`; requires `orders:read` in token and connection |
| Authorization | `application/authorize-assistant.ts` | Saves `scopes: ["orders:read"]` |
| `/authorize` hook | `infrastructure/oauth-hooks.ts` | Rewrites the requested scope to `grantedOAuthScope`; drops the stored consent when no active connection exists |
| Plugin scope check | `@better-auth/oauth-provider` 1.7.14, `authorize` | Refuses requested scopes outside `client.scopes` with `invalid_scope` (verified in `dist/authorize-*.mjs`) |
| Consent texts | `app/locales.ts` `assistants.*` (es, pt) | Orders only; `app/routes/assistant-authorize.tsx` renders `canSee1..3`, `never1..2` |
| Product list (app) | `features/products/application/list.ts`, `infrastructure/repository.ts` `list` | `search` (ILIKE name or SKU), `stock` product-level, `sort`, page; one id query plus one grouped summary query |
| Public catalog reads | `features/products/infrastructure/catalog-products-repository.ts` | Active product with an active variant and `currency = store currency`; `unaccent(lower(name)) LIKE …` |
| Product aggregate read | `productRepository.get` (`infrastructure/repository.ts` `readProducts`) | Six batched queries per call, validated rows, `INVALID_STORED_DATA` on bad rows |
| Saved variant order | `domain/product-structure.ts` `sortVariants`, `orderedAttributes` | Pure, from the aggregate's option and value positions |
| SKU lookup | `infrastructure/repository.ts` `findSkuOwners`; `order-stock.ts` `findProductIdsOfVariants` | By `lower(btrim(sku))`, served by `ProductVariant_companyId_sku_normalized_key` |
| Catalog settings | `features/catalog/infrastructure/catalog-settings-repository.ts` `readCatalogSettings`; `storefront-config.ts` `storeUrl(subdomain, path = "/"): URL` | Published flag, subdomain and company name; no country or currency; `catalogSettings.get` also computes a subdomain suggestion (extra query) |
| Storefront capability | `features/catalog/composition.ts` `catalogStorefront` | `{ resolve, resolveOwner }` by host; no read by company |
| Refusal reasons | `application/resolve-assistant-access.ts` `RefusalReason` | `not_ready \| no_connection \| inactive \| password_changed \| scope`; `endConnection` reason `inactive \| password_reset` (also in `connection-access-repository.ts`) |
| Store currency | `@shared/country` `countryCurrencies[Company.country]` | Used by `resolveSubdomain` |
| Product indexes | `prisma/migrations/*` | `Product(companyId)`, `Product.name` GIN trigram (global), `ProductVariant` unique `(companyId, id)`, `(companyId, productId, id)`, `(companyId, productId, combinationKey)`, `(companyId, lower(btrim(sku)))` partial, `ProductVariant.sku` GIN trigram (global), `ProductStock` unique `(companyId, variantId)`, `ProductVariantOptionValue` PK `(companyId, variantId, optionId)` and `(companyId, optionId, valueId)`, `ProductOption` unique `(companyId, productId, id)`, `ProductOptionValue` unique `(companyId, optionId, id)`; extensions `pg_trgm`, `unaccent` |
| Read snapshot | `shared/infrastructure/persistance.ts` | `withinReadSnapshot`, `withinTransaction(…, { isolationLevel, statementTimeoutMs })` |
| Web E2E | `apps/core/tests/e2e/assistants.spec.ts` | Consent and settings journey with order texts |

## 4. Gaps this design closes

1. No `products:read` scope, no product tools, no consent lines for products (sections 5.1, 5.4, 12).
2. Connections authorized before this task keep working with orders only, and their clients cannot request the new scope (sections 5.2, 5.3).
3. Server instructions and the order paragraph impose Spanish answers and literal quotes (section 5.5).
4. The registry answers a product failure with the order reading-failure text (section 5.5).
5. `features/products` has no filtered search by variant values, price range, variant stock level or catalog presence, no store vocabulary of option values, and no read by SKU for the assistant (sections 5.6, 5.7, 7).
6. No single definition of «stock bajo» that MCP 4/4 can reuse (section 6.1).
7. `features/catalog` has no cheap read of the storefront state with the store currency (section 5.8).

## 5. Use cases

### 5.1 `authorizeAssistant` (modified, assistants)

Change: the saved connection carries `scopes: [...assistantScopes]` instead of `["orders:read"]`. Nothing else changes.

### 5.2 Connection activity (modified, assistants domain)

```ts
export type ConnectionEndReason = "inactive" | "password_reset" | "consent_outdated";
/** Null while the connection is active. Password change first, then a consent that misses a current scope, then inactivity. */
export function connectionEndReason(connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number): ConnectionEndReason | null;
export function isConnectionActive(connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number): boolean; // connectionEndReason(...) === null
```

`consent_outdated` when `assistantScopes.some((scope) => !connection.scopes.includes(scope))`.

`resolveAssistantAccess` (modified): uses `connectionEndReason`; for a non-null reason it calls `endConnection(connection, reason)` and refuses with `RefusalReason` `password_changed`, `consent_outdated` (new literal of `RefusalReason`) or `inactive`. `endConnection`'s reason type becomes `ConnectionEndReason`. The `orders:read` requirement becomes «the intersection of token and connection scopes is not empty»; a token minted before re-authorization keeps only the tools of its own scopes until it expires (at most one access-token lifetime). No new lookup is added to the path.

`listAssistantConnections`, `createHasActiveConnection` and `saveConnection` are unchanged in code: they call `isConnectionActive`, which now includes the scope rule.

### 5.3 `/authorize` hook: align client scopes (modified, assistants infrastructure)

```ts
// OAuthHookDependencies gains:
alignClientScopes: (oauthClientId: OAuthClientId) => Promise<Result<"aligned" | "unchanged", PersistenceError>>;
```

Flow of `authorizeHook`, before any session read: parse parameters (unchanged), then `alignClientScopes(client_id)`: `UPDATE "oauthClient" SET scopes = $oauthScopes WHERE "clientId" = $id AND scopes IS DISTINCT FROM $oauthScopes` through `systemPrisma` (global table, like `dropConsent`). An unknown client updates nothing and the plugin answers its own error. A persistence failure throws `503 server_error` like the other hook failures. Then the existing flow (session, marker, active connection, drop consent). The registration hook is unchanged: new clients already get `grantedOAuthScope`.

Assumption verified in T1: the column is `oauthClient.scopes` (`String[]`, field `scopes` of `OauthClient` in `schema.prisma`) and the plugin reads the client after `hooks.before` returns.

### 5.4 Product tool calls (new, assistants presentation)

Both tools run inside the connection's tenant context (`withTenantIsolation` of `mcp-routes`) and after the unchanged pipeline of `answerToolCall` (store limit, «Último uso», input schema). Their dependencies:

```ts
export type ProductToolsDependencies = Readonly<{
  appLink: (productId: ProductId) => string;                                   // `${authIssuer}/products/<id>`
  describeStorefront: (access: AssistantAccess) => Read<StorefrontState>;
  search: (criteria: ProductSearchCriteria, access: AssistantAccess) => Read<ProductSearchOutcome>;
  find: (reference: ProductReference, access: AssistantAccess) => Read<FoundProduct | null>;
}>;
type Read<T> = Promise<Result<T, ToolRunError>>;
```

`src/composition/assistant-product-capabilities.ts` wires them to `catalogStorefront.describe`, `products.searchForAssistant` and `products.findForAssistant`, logs `assistant_tool_failed` once per failed read (as `assistant-order-capabilities.ts` does) and answers `{ code: "FAILURE", message: productReadFailureText }`.

**`buscar_productos`**

1. `describeStorefront` (gives the catalog line, the subdomain and the store currency for messages).
2. Map the validated Spanish input to `ProductSearchCriteria` (section 6.2): «con stock» → `in_stock`, «stock bajo» → `low`, «agotado» → `sold_out`; «sí»/«si» → `true`, «no» → `false`; each `valores` entry split at its first `:` into `{ option, value }` when both sides are non-empty; amounts to `PriceCents`.
3. `search(criteria)`.
4. Map the outcome: `PRICE_RANGE_REVERSED` and `VARIANT_FILTER_OUTSIDE_CATALOG` → `INVALID_INPUT` with the product draft texts; `VALUE_REJECTED` → `INVALID_INPUT` with the vocabulary message built by `vocabularyMessage(rejection)`; a page → output with `toAssistantProductSummary` per item, the catalog line, `hay_mas` and, for an empty page, `mensaje` («No hay productos con esos filtros: …» from the applied criteria, or «Tu tienda todavía no tiene productos.» when `storeHasProducts` is false). An empty page is `empty: true`.

**`ver_producto`**

1. `describeStorefront`.
2. Input is exactly one of `producto` and `sku`. A `producto` that is not a UUID is treated as unknown (same answer as not found, no lookup).
3. `find({ by: "id", id } | { by: "sku", sku })`; `null` → `NOT_FOUND` with «No encontré ese producto en tu tienda. Búscalo con Buscar productos.».
4. `toAssistantProduct(found, storefront, context)`.

Errors: `ToolRunError` codes `INVALID_INPUT`, `NOT_FOUND`, `FAILURE`; nothing else reaches the agent.

### 5.5 Language and module failure text (modified, assistants presentation)

- `generalInstructions`: the Spanish-only sentence is replaced by the rule of the product draft ([Language](mcp-products.md#language)): answer in the language the owner writes in; tool texts come in Spanish and are translated; product names, combinations, values, SKUs, links, amounts, dates and order numbers are store data and stay unchanged.
- `orderToolsInstructions`: «cítalo tal cual» → «transmite su sentido sin convertirlo en una promesa, en el idioma del dueño».
- `ToolModule` gains `readFailureMessage: string`; `ToolDefinition` carries it; `render` uses `definition.readFailureMessage` for `INVALID_TOOL_OUTPUT` and for `failure` with `message: null`. The order module sets the current order text; the exported `readFailureMessage` constant of the registry is removed.
- `checkToolModules` adds two violations: an instruction paragraph, title or description containing «en español» (accent- and case-insensitive) or «tal cual»; a module whose `readFailureMessage` is empty.

### 5.6 `searchForAssistant` (new, products application)

File `features/products/application/search-for-assistant.ts`.

```ts
export type SearchForAssistantDependencies = Readonly<{
  snapshot: <T>(read: () => Promise<Result<T, ProductReadError>>) => Promise<Result<T, ProductReadError>>; // RepeatableRead, read only, statement timeout
  readVocabulary: () => Promise<Result<readonly VocabularyRow[], ProductReadError>>;
  searchPage: (query: ProductSearchQuery) => Promise<Result<ProductSearchPage, ProductReadError>>;
}>;
export type SearchForAssistantError =
  | Readonly<{ code: "PRICE_RANGE_REVERSED"; from: PriceCents; to: PriceCents; message: string }>
  | Readonly<{ code: "VARIANT_FILTER_OUTSIDE_CATALOG"; message: string }>
  | Readonly<{ code: "VALUE_REJECTED"; rejection: ValueRejection; message: string }>
  | ProductReadError;
export type ProductSearchOutcome = ProductSearchPage;
export async function searchForAssistant(input: ProductSearchCriteria, access: ProductAccess, deps: SearchForAssistantDependencies): Promise<Result<ProductSearchPage, SearchForAssistantError>>;
```

Flow:

1. `checkSearchCriteria(input)` (domain): `priceFrom > priceTo` → `PRICE_RANGE_REVERSED`; `inCatalog === false` with any of `values`, `priceFrom`, `priceTo`, `stock` → `VARIANT_FILTER_OUTSIDE_CATALOG`.
2. Inside `snapshot`:
   1. With `values`: `readVocabulary()`, `buildVocabulary(rows)`, `resolveValues(input.values, vocabulary)`; a rejection ends the snapshot with `VALUE_REJECTED`.
   2. `searchPage({ text, valueIdSets, priceFrom, priceTo, stock, inCatalog, sort, offset: (page - 1) * 20, limit: 20, lowStockThreshold, matchingVariantCap: 10 })`.
3. Return the page.

`access` is the tenant (`ProductAccess`); the repository reads the tenant from the transaction context like every product adapter.

### 5.7 `findForAssistant` (new, products application)

File `features/products/application/find-for-assistant.ts`.

```ts
export type ProductReference = Readonly<{ by: "id"; id: ProductId }> | Readonly<{ by: "sku"; sku: string }>;
export type FoundProduct = Readonly<{ product: Product; searchedVariantId: VariantId | null }>; // product.variants in saved order
export type FindForAssistantDependencies = Readonly<{
  snapshot: SearchForAssistantDependencies["snapshot"];
  findSkuOwners: (normalizedSkus: readonly string[]) => Promise<Result<ReadonlyMap<string, VariantId>, ProductReadError>>;
  findProductIdsOfVariants: (ids: readonly VariantId[]) => Promise<Result<ReadonlyMap<VariantId, ProductId>, ProductReadError>>;
  getProduct: (id: ProductId) => Promise<Result<Product | null, ProductReadError>>;   // productRepository.get
}>;
export async function findForAssistant(reference: ProductReference, access: ProductAccess, deps: FindForAssistantDependencies): Promise<Result<FoundProduct | null, ProductReadError>>;
```

Flow inside one snapshot: by SKU, normalize as the unique index does (`lower(btrim(sku))`: lower case, surrounding spaces removed; `findSkuOwners` expects values already normalized), find the owner variant, then its product id; absent → `ok(null)`. Then `getProduct(id)`; absent → `ok(null)`. Return the product with `variants: sortVariants(product)` and `searchedVariantId` (null by id). Photos are not resolved: `findForAssistant` calls `productRepository.get` directly, not the `getProduct` use case, so no image URL is signed and `IMAGE_NOT_FOUND` cannot fail a read; the photo ids the aggregate carries are never projected.

### 5.8 `catalogStorefront.describe` (new, catalog)

The existing `catalogStorefront` object of `features/catalog/composition.ts` gains `describe`; `resolve` and `resolveOwner` are unchanged.

```ts
export type StorefrontState = Readonly<{ currency: Currency; catalog:
  | Readonly<{ kind: "published"; subdomain: CatalogSubdomain }>
  | Readonly<{ kind: "hidden"; subdomain: CatalogSubdomain }>
  | Readonly<{ kind: "hidden_without_link" }> }>;
describe: (companyId: CompanyId) => Promise<Result<StorefrontState, CatalogSettingsError>>;
```

One `SELECT "catalogPublished", "catalogSubdomain", country FROM "Company" WHERE id = $companyId` under RLS (new `readStorefrontState` in `catalog-settings-repository.ts`), parsed with Zod; invalid subdomain or country → `INVALID_STORED_DATA`; absent company → `PERSISTENCE_UNAVAILABLE` (a connection's company always exists). It does not compute a subdomain suggestion. The assistant builds URLs with `storeUrl(subdomain)` and `storeUrl(subdomain, "/productos/<id>")`.

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

`VariantStockFilter` is new because the app's `StockFilter` (`in_stock | sold_out`) is product-level. The level applies only to active variants; callers never pass a product total.

### 6.2 Search criteria and values (`features/products/domain/product-search.ts`)

```ts
export type MatchKey = string & { readonly __brand: "MatchKey" };
export function matchKeyOf(text: string): MatchKey;                   // NFD, \p{M} removed, toLowerCase, trim
export type PriceCents = number & { readonly __brand: "PriceCents" }; // 0..99_999_999_999
export function parsePriceCents(amount: number): Result<PriceCents, "NEGATIVE" | "TOO_MANY_DECIMALS" | "TOO_LARGE">;
export type ValueQuery = Readonly<{ written: string; option: Readonly<{ written: string; key: MatchKey }> | null; key: MatchKey }>;
export type ProductSearchCriteria = Readonly<{
  text?: string;                                   // trimmed, 1..120 characters
  values?: readonly [ValueQuery, ...ValueQuery[]]; // at most 3
  priceFrom?: PriceCents; priceTo?: PriceCents;
  stock?: VariantStockFilter;
  inCatalog?: boolean;
  sort: "recent" | "name";
  page: number;                                    // safe positive integer
}>;
export function checkSearchCriteria(criteria: ProductSearchCriteria): Result<ProductSearchCriteria, "PRICE_RANGE_REVERSED" | "VARIANT_FILTER_OUTSIDE_CATALOG">;
```

`PriceCents` exists because `Money.amount` is a float; SQL compares `salePrice` with `$cents::numeric / 100`, exactly.

Vocabulary:

```ts
/** One row per distinct (option name, value name) as written, held by an active variant. */
export type VocabularyRow = Readonly<{ optionName: string; valueName: string; valueIds: readonly OptionValueId[]; productRank: number; position: number }>;
export type StoreVocabulary = readonly Readonly<{ name: string; key: MatchKey;
  values: readonly Readonly<{ name: string; key: MatchKey; valueIds: readonly OptionValueId[] }>[] }>[];
export function buildVocabulary(rows: readonly VocabularyRow[]): StoreVocabulary;
export type ValueRejection =
  | Readonly<{ kind: "no_options" }>
  | Readonly<{ kind: "unknown_value"; written: string; vocabulary: StoreVocabulary }>
  | Readonly<{ kind: "value_in_other_option"; written: string; option: string; vocabulary: StoreVocabulary }>
  | Readonly<{ kind: "unknown_option"; option: string; vocabulary: StoreVocabulary }>;
/** One id set per query, in query order. */
export function resolveValues(queries: readonly ValueQuery[], vocabulary: StoreVocabulary): Result<readonly (readonly OptionValueId[])[], ValueRejection>;
```

- `buildVocabulary` merges rows by option key and, within an option, by value key; the written form is the one with the lowest `productRank` (newest product); options are sorted by `name.localeCompare(other, "es")`; values by `(productRank, position)` of their first occurrence, which reproduces «products newest first, values in saved order». Value ids of merged rows are concatenated.
- `resolveValues`: empty vocabulary → `no_options`. With an option: unknown option key → `unknown_option`; value key absent under it → `value_in_other_option` when another option holds it, else `unknown_value`. Without an option: the ids of that value key under every option; none → `unknown_value`. The first failing query decides.
- The 100-value cap and «y 30 valores más» belong to the message, not the domain (section 6.4).

### 6.3 Search page (`features/products/application/search-for-assistant.ts`)

```ts
export type SkuSummary = Readonly<{ kind: "single"; sku: string | null }> | Readonly<{ kind: "several" }>;
export type ActiveSummary =
  | Readonly<{ kind: "none"; sku: SkuSummary }>                       // over all variants
  | Readonly<{ kind: "some"; count: number; minSalePrice: Money; hasDifferentPrices: boolean; totalStock: number; soldOut: number; low: number; sku: SkuSummary }>;
export type SearchedVariant = Readonly<{ id: VariantId; values: readonly string[]; sku: string | null; salePrice: Money; stock: number }>; // values in option order
export type SearchedProduct = Readonly<{
  id: ProductId; name: string; currency: Currency; variantCount: number; inactiveCount: number; active: ActiveSummary;
  matching: Readonly<{ variants: readonly SearchedVariant[]; total: number }> | null;  // null without variant filters; at most 10 variants
}>;
export type ProductSearchPage = Readonly<{ items: readonly SearchedProduct[]; page: number; total: number; storeHasProducts: boolean }>;
export type ProductSearchQuery = Readonly<{
  text?: string; valueIdSets: readonly (readonly OptionValueId[])[]; priceFrom?: PriceCents; priceTo?: PriceCents; stock?: VariantStockFilter;
  inCatalog?: boolean; sort: "recent" | "name"; offset: number; limit: number; lowStockThreshold: number; matchingVariantCap: number;
}>;
```

`ActiveSummary` is a union so a product without active variants can never carry a price, stock or level. `SearchedProduct` is new because `ProductSummary` of the app list has no level counts, no inactive count and no matching variants, and the app list must not grow them.

### 6.4 Assistant projection (`features/assistants/domain/product-projection.ts`)

Pure functions with a `ProductProjectionContext = { display: Display; appLink: (id) => string; customerLink: (id) => string | null }`:

| Function | Produces |
| --- | --- |
| `catalogLine(state)` | The three catalog sentences of the product draft |
| `stockLine(active)` | «Stock: 12 · 1 agotada, 1 con stock bajo», «Stock: 0 · Agotado», «Stock: 6 · 6 con stock bajo», a one-variant level; `undefined` for `kind: "none"` |
| `toAssistantProductSummary(product, context)` | One search item; never the purchase price |
| `toAssistantProduct(found, storefront, context)` | The **Ver producto** answer; description cut at 1,000 characters with «… (la descripción continúa en Yoyos)» |
| `vocabularyMessage(rejection)` | The four texts with at most 100 values and «y N valores más» |
| `appliedFiltersLine(criteria, currency)` | «texto "polos", stock bajo, precio hasta S/ 30.00» for empty answers |
| `combinationOf(values)` | Values joined by « / », cut at 50 |

Output types are the `z.infer` of the strict output schemas of `products-tools.ts`, checked with `satisfies` as the order projection does. Field names (Spanish snake case):

- `buscar_productos`: `{ catalogo, pagina, total, hay_mas?, mensaje?, productos: [{ id, nombre, sku, precio, stock?, en_catalogo, variantes, enlace, enlace_cliente?, variantes_coincidentes?: [{ combinacion, sku, precio, stock, nivel? }], mas_variantes? }] }`.
- `ver_producto`: `{ catalogo, id, nombre, descripcion?, opciones: [{ nombre, valores: [text] }], en_catalogo, stock?, enlace, enlace_cliente?, variantes: [{ combinacion, sku, precio, precio_compra, stock, nivel?, estado: "Activa" | "Desactivada", buscada_por_sku?: true }] }`.

`stock` of a variant is a number; `nivel` is «Agotado» or «Stock bajo», absent above the threshold and on deactivated variants. `precio_compra` is «Sin precio de compra» when absent. No field can hold a QR code, a photo or an image URL.

| Layer | Types and authority |
| --- | --- |
| products domain | `lowStockThreshold`, `StockLevel`, `MatchKey`, `PriceCents`, `ProductSearchCriteria`, vocabulary and value resolution: the only definitions |
| products application | `searchForAssistant`, `findForAssistant`, `SearchedProduct`, `FoundProduct` |
| assistants domain | Spanish projection, catalog and stock lines; consumes the products types, decides no product rule |
| assistants presentation | Spanish input schemas and their mapping to `ProductSearchCriteria`, output schemas, texts |

## 7. Persistence

No schema change, no migration, no data change. `database-migrations` is not involved.

### 7.1 Queries

All run under the tenant's RLS context and also filter `"companyId" = $companyId` explicitly, so the planner can use the company-leading indexes.

**Vocabulary** (`readVocabulary`, only when `valores` is sent):

```sql
SELECT o.name AS "optionName", ov.name AS "valueName", array_agg(DISTINCT ov.id) AS "valueIds",
       min(p.rank) AS "productRank", (array_agg(ov.position ORDER BY p.rank, ov.position))[1] AS position
FROM "ProductVariantOptionValue" l
JOIN "ProductVariant" v       ON v."companyId" = l."companyId" AND v.id = l."variantId" AND v.status = 'active'
JOIN "ProductOption" o        ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
JOIN "ProductOptionValue" ov  ON ov."companyId" = l."companyId" AND ov."optionId" = l."optionId" AND ov.id = l."valueId"
JOIN (SELECT id, row_number() OVER (ORDER BY "createdAt" DESC, id) AS rank FROM "Product" WHERE "companyId" = $c) p ON p.id = l."productId"
WHERE l."companyId" = $c
GROUP BY o.name, ov.name
```

Access: `ProductVariantOptionValue_companyId_optionId_valueId_idx` (leading `companyId`) or the PK, `ProductVariant_companyId_id_key`, `ProductOption_companyId_productId_id_key`, `ProductOptionValue_companyId_optionId_id_key`, `Product_companyId_idx`. `position` is the value's position in the newest product holding it, so `(productRank, position)` is one product's saved order and never mixes positions of two products. Rows scanned: the store's variant links (variants × options); rows returned: distinct spellings (tens to a few hundred).

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
                                WHERE l."companyId" = v."companyId" AND l."variantId" = v.id AND l."valueId" = ANY($ids1::uuid[]))]  -- one per value set
                )]
)
SELECT ARRAY(SELECT id FROM matching ORDER BY <order> LIMIT $limit OFFSET $offset) AS ids,
       (SELECT count(*)::int FROM matching) AS total,
       EXISTS (SELECT 1 FROM "Product" WHERE "companyId" = $c) AS "storeHasProducts"
```

Order: `"createdAt" DESC, id ASC` or `name COLLATE "es-x-icu" ASC, id ASC` (the app list's orders, deterministic with the tie-breaker). The variant filters live in **one** `EXISTS` so they apply to the same variant. Optional fragments are composed with `Prisma.sql`/`Prisma.join`; every value is a parameter.

Access: `Product_companyId_idx` for the store's products; per product, `ProductVariant_companyId_productId_id_key` (prefix `companyId, productId`), `ProductStock_companyId_variantId_key`, `ProductVariantOptionValue` PK prefix `(companyId, variantId)`. The global trigram GIN indexes are not company-leading and do not serve `unaccent(lower(…))`; they are not relied on. The cost is linear in the store's own products and variants, never in other companies' rows.

**Page summaries** (one statement for the at most 20 ids): the app list's grouped `summarySql` shape plus `count(*) FILTER (WHERE active AND quantity = 0)`, `count(*) FILTER (WHERE active AND quantity BETWEEN 1 AND $threshold)`, the inactive count and the SKU summary over active variants and over all variants.

**Matching variants** (one statement, only with variant filters): the same variant predicate for `productId = ANY($pageIds)`, each row with its values in option order (`array_agg(ov.name ORDER BY o.position)`) and its saved-order key (`array_agg(ov.position ORDER BY o.position)`), `row_number() OVER (PARTITION BY productId ORDER BY key, id) <= 10` and `count(*) OVER (PARTITION BY productId)`.

**Detail**: `findSkuOwners`, `findProductIdsOfVariants` and `productRepository.get` as they are.

Per call: storefront 1 statement; search 2 to 4 statements; detail 1 to 8. Constant in the number of products and variants: no N+1.

### 7.2 Rows read

Every raw row is parsed with a Zod schema in `infrastructure/product-search-repository.ts` (`vocabularyRowSchema`, `pageRowSchema`, `summaryRowSchema`, `matchingVariantRowSchema`): decimals as strings converted with `Prisma.Decimal`, `bigint` stock within the safe integer range, currency through `isCurrency`. A row that fails is `INVALID_STORED_DATA` with `invalid_stored_product_data` logged, never an empty result.

### 7.3 Performance check (T3)

Seed in `core_test`: store A with 2,000 products × 6 active variants (Color × Talla, 12,000 variants), 10 % deactivated, stock spread over 0, 1–3 and above; store B with 20,000 products. After `ANALYZE`, `EXPLAIN (ANALYZE, BUFFERS)` of the page statement for store A with `valores` (2 sets), price range, `stock: low` and `texto`, and of the vocabulary statement. Accepted when no plan node scans `ProductVariant`, `ProductStock` or `ProductVariantOptionValue` sequentially across companies and each statement runs under 150 ms on development hardware (initial value). The plans and timings go in the pull request. If the check fails, the implementer stops and escalates with the plan; no index is added without review.

## 8. Contracts between applications

None. Mobile is not touched and `shared/contracts/products.ts` does not change (section 2). The MCP tool schemas are the contract with agents; they live in `products-tools.ts`, strict on input (unknown field → «No existe el campo …»), strict on output.

## 9. Events and cross-feature integration

No event. Cross-feature capabilities:

| Consumer | Capability | Provider |
| --- | --- | --- |
| `features/assistants` (through `src/composition/assistant-product-capabilities.ts`) | `products.searchForAssistant(criteria)`, `products.findForAssistant(reference)` | `features/products/composition.ts` |
| same | `catalogStorefront.describe(companyId)`, `storeUrl` | `features/catalog/composition.ts`, `features/catalog/index.ts` |
| MCP 4/4 (later) | `lowStockThreshold`, `stockLevelOf`, `VariantStockFilter` | `features/products/domain/stock-level.ts` |

## 10. Mobile

No change.

## 11. Transactions and concurrency

Reads only.

1. Storefront: one statement, no transaction.
2. Search: one `withinTransaction(…, { isolationLevel: "RepeatableRead", statementTimeoutMs })` read-only snapshot holding vocabulary, page ids and total, summaries and matching variants, so the total, the page and the vocabulary never disagree with a concurrent save.
3. Detail: one snapshot holding the SKU lookup and the aggregate read.
4. A concurrent product save between two tool calls only changes the next answer. Repeating a call is always safe.

Writes outside tools: the `oauthClient.scopes` alignment is one idempotent conditional `UPDATE` (two concurrent `/authorize` requests write the same value); ending a connection reuses `endConnection` (delete, then best-effort revocation) unchanged.

## 12. Code organization

| File | Change | Task |
| --- | --- | --- |
| `apps/core/src/features/assistants/domain/scopes.ts` | `products:read` literal | T1 |
| `…/assistants/domain/assistant-connection.ts` (+ test) | `ConnectionEndReason`, `connectionEndReason`, scope rule in `isConnectionActive` | T1 |
| `…/assistants/application/resolve-assistant-access.ts` (+ test) | Reason from `connectionEndReason`, `consent_outdated` refusal, non-empty scope intersection | T1 |
| `…/assistants/application/authorize-assistant.ts` (+ test), `assistant-fixtures.ts` | `[...assistantScopes]` | T1 |
| `…/assistants/infrastructure/connection-access-repository.ts` | `endConnection` reason type | T1 |
| `…/assistants/infrastructure/oauth-hooks.ts` (+ test), `…/assistants/auth-hooks.ts` | `alignClientScopes` dependency and adapter | T1 |
| `…/assistants/infrastructure/*.integration.test.ts`, `presentation/assistant-lifecycle.integration.test.ts`, `presentation/oauth-metadata-routes.integration.test.ts` | New scope string, outdated connections | T1 |
| `apps/core/app/locales.ts`, `app/routes/assistant-authorize.tsx` (+ test), `tests/e2e/assistants.spec.ts` | Consent and settings texts of the product draft (es, pt), two new «Podrá ver» lines | T1 |
| `…/assistants/presentation/server-instructions.ts` (+ new test) | Language rule | T2 |
| `…/assistants/presentation/tools/orders-texts.ts`, `orders-tools.ts` | «tal cual» sentence; `readFailureMessage` of the order module | T2 |
| `…/assistants/presentation/tool-module.ts`, `tool-registry.ts` (+ new `tool-registry.test.ts`) | `readFailureMessage` per module, language checks | T2 |
| `apps/core/src/composition/assistant-tools.test.ts` | Fixture module gets `readFailureMessage` | T2, then T4 |
| `…/products/domain/stock-level.ts` (+ test) | New | T3 |
| `…/products/domain/product-search.ts` (+ test) | New | T3 |
| `…/products/application/search-for-assistant.ts` (+ test), `find-for-assistant.ts` (+ test) | New | T3 |
| `…/products/infrastructure/product-search-repository.ts` (+ integration test), `product-search-fixtures.ts` | New queries, row schemas, seed for the performance check | T3 |
| `…/products/composition.ts` | `searchForAssistant`, `findForAssistant` in `products` | T3 |
| `apps/core/.env.example` | `PRODUCT_SEARCH_STATEMENT_TIMEOUT_MS=2000` | T3 |
| `…/catalog/infrastructure/catalog-settings-repository.ts`, `…/catalog/composition.ts` (+ test) | `readStorefrontState`, `catalogStorefront.describe` | T4 |
| `…/assistants/domain/product-projection.ts` (+ test) | New | T4 |
| `…/assistants/presentation/tools/products-tools.ts` (+ test), `products-texts.ts` | New module | T4 |
| `apps/core/src/composition/assistant-product-capabilities.ts` | New wiring | T4 |
| `apps/core/src/composition/assistant-tools.ts`, `assistant-tools.test.ts` | Product module entry; six tools | T4 |
| `…/assistants/presentation/products-tools.integration.test.ts` | New, MCP client against a real database | T4 |

`docs/assistants.md` and `docs/products.md` are updated at promotion, when the branch merges (Documentation skill), not by the tasks.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `assistant_tool_called` | info | `tool-registry.ts` (unchanged) | `["companyId", "connectionId", "tool", "outcome", "durationMs"]`; `tool` is `buscar_productos` or `ver_producto` |
| `assistant_tool_failed` | error | `assistant-product-capabilities.ts`, `tool-registry.ts` | `["companyId", "connectionId", "tool", "errorCode"]` |
| `assistant_access_refused` | info | `mcp-routes.ts` (unchanged) | existing, with `reason: "consent_outdated"` |
| `assistant_connection_ended` | info | `connection-access-repository.ts` | existing, with `reason: "consent_outdated"` |
| `assistant_client_scopes_aligned` | info | `auth-hooks.ts` adapter | `["oauthClientId"]` |
| `assistant_authorize_hook_failed` | error | existing | existing, `errorCode` of the alignment |
| `product_search_failed` | error | `product-search-repository.ts` | `["companyId", "stage", "errorCode", "durationMs"]`; `stage` ∈ `vocabulary`, `page`, `summaries`, `matching_variants`; `errorCode` ∈ `PERSISTENCE_UNAVAILABLE`, `STATEMENT_TIMEOUT` |
| `invalid_stored_product_data` | error | existing | existing fields, `stage` as above |
| `unable_to_read_catalog` | error | `catalog-settings-repository.ts` | existing, `operation: "read_storefront"` |

Never logged: tool inputs and outputs, search text, values, SKUs, prices, product names, the store subdomain.

## 14. Tests

### Unit (core, Vitest)

`features/products/domain/stock-level.test.ts`
- `test("classifies 0 as sold out, 1 to 3 as low and 4 as available")`
- `test("counts low variants as in stock for the in-stock filter")`

`features/products/domain/product-search.test.ts`
- `test("matches «azul», « Azul » and «AZÚL» to the same key and never «Azul claro»")`
- `test("refuses a price with three decimals, a negative one and one above the stored maximum")`
- `test("refuses a reversed price range")`
- `test("refuses a variant filter together with en_catalogo no")`
- `test("lists options alphabetically and values in saved order, newest product first, so sizes read S, M, L")`
- `test("lists a value written «azul» and «Azul» once, as written in the newest product")`
- `test("resolves «M» to the ids of every option that holds it")`
- `test("resolves «Talla: M» only to the ids under Talla")`
- `test("rejects «Color: M» as a value that exists only under another option")`
- `test("rejects «Material: Algodón» as an unknown option")`
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

`features/assistants/domain/assistant-connection.test.ts`
- `test("ends a connection that lacks a current data scope as consent_outdated")`
- `test("reports a password change before an outdated consent and an outdated consent before inactivity")`

`features/assistants/application/resolve-assistant-access.test.ts`
- `test("ends an orders-only connection on its next call and refuses it as consent_outdated")`
- `test("keeps only the token's scopes for a token minted before re-authorization")`

`features/assistants/application/authorize-assistant.test.ts`
- `test("saves the connection with the orders and products scopes")`

`features/assistants/infrastructure/oauth-hooks.test.ts`
- `test("aligns the client's scopes before the plugin reads the client on authorize")`
- `test("answers 503 when the client scopes cannot be aligned")`

`features/assistants/presentation/tool-registry.test.ts`
- `test("answers a product tool's thrown read with the products reading-failure text")`
- `test("answers an order tool's invalid output with the orders reading-failure text")`
- `test("reports a module whose instructions say to answer in Spanish")`
- `test("reports a description that says to quote a reason «tal cual»")`

`features/assistants/presentation/server-instructions.test.ts`
- `test("tells the agent to answer in the owner's language and to keep store data unchanged")`

`features/assistants/domain/product-projection.test.ts`
- `test("summarizes S = 0, M = 2, L = 10 as «Stock: 12 · 1 agotada, 1 con stock bajo»")`
- `test("summarizes six sizes at 1 unit as «Stock: 6 · 6 con stock bajo»")`
- `test("shows «Stock: 0 · Agotado» only when every active variant is at 0")`
- `test("shows the level of a product with one variant")`
- `test("gives a product without active variants no price, no stock line, no level and no customer link")`
- `test("never includes a purchase price in a search item")`
- `test("adds the customer link only when the catalog is published and the product is in it")`
- `test("cuts a 1,500-character description at 1,000 with «… (la descripción continúa en Yoyos)»")`
- `test("shows «Sin precio de compra» when it was never entered and «S/ 0.00» when it was entered as 0")`
- `test("lists 10 matching variants and «y 4 variantes más: usa Ver producto»")`
- `test("cuts the value list at 100 with «y 30 valores más»")`
- `test("writes the applied filters in an empty answer")`

`features/assistants/presentation/tools/products-tools.test.ts`
- `test("maps «stock bajo», «sí» and «Color: Azul» to the search criteria")`
- `test("refuses more than three values with the field and the remedy")`
- `test("refuses ver_producto with both producto and sku, and with neither")`
- `test("answers a non-UUID product identifier like an unknown product without reading")`
- `test("answers «Tu tienda todavía no tiene productos.» with the catalog line in an empty store")`

`src/composition/assistant-tools.test.ts` (static validator)
- `test("lists the six tools, all read only, for a connection with both scopes")`
- `test("keeps a search page of 20 products at maximum lengths within 24 KB")`
- `test("keeps a search page of 20 products with 3 matching variants each at maximum lengths within 24 KB")`
- `test("keeps a product of 60 variants with a 1,000-character description at maximum lengths within 24 KB")`
- `test("answers a product of 100 variants at maximum lengths complete")`

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
- `test("builds the vocabulary from active variants only")` (acceptance 8)
- `test("never reads another store's products, values or SKUs")` (acceptance 20)
- `test("reports stored data that fails its schema as invalid stored data")`

`features/catalog/infrastructure/catalog-settings-repository.integration.test.ts`
- `test("describes a published, a hidden and a never-linked catalog with the store currency")`

`features/assistants/presentation/products-tools.integration.test.ts`
- `test("answers buscar_productos through the MCP server with the catalog line and customer links")` (acceptance 12)
- `test("answers ver_producto by SKU and by identifier, and another store's product as not found")` (acceptance 14)
- `test("counts product calls in the store limit shared with order tools")` (acceptance 21)
- `test("leaves every product, price and stock unchanged after any sequence of calls")` (acceptance 23)

`features/assistants/presentation/assistant-lifecycle.integration.test.ts`
- `test("hides an orders-only connection from the list, ends it on its next call and shows the screen again")` (acceptance 18)
- `test("re-authorizes an agent registered before products with its own client and lists six tools")` (acceptance 18)

`features/assistants/presentation/oauth-metadata-routes.integration.test.ts`
- `test("advertises orders:read, products:read and offline_access")`

### Web E2E (happy path)

`tests/e2e/assistants.spec.ts`
- `test("connects an agent on a screen that lists orders and products")` (acceptance 19, Spanish route; the Portuguese texts are covered by the route test of `assistant-authorize.tsx`)

### Pending manual checks

- Claude and ChatGPT against a preview: «¿Tienes polos azules en M?», «¿Qué se me está acabando?», «¿Cuánto me costó la casaca negra?» (purchase price only from **Ver producto**), «¿qué categorías tengo?».
- Portuguese: «Quais camisetas azuis eu tenho?» and «O que eu despacho hoje?» answer in Portuguese with store data unchanged (acceptance 22).
- An agent connected before the release re-authorizes by itself after its first refused call; the founder's own connections must be connected again.

## 15. Limits and checks during implementation

- **Budget arithmetic** (ASCII at maximum lengths): a search item ≈ 1.05 KB with name 100, SKU 40, three matching variants (combination 50, SKU 40) and both links, so 20 items ≈ 21 KB; a **Ver producto** variant ≈ 0.29 KB with combination 50 and SKU 100, so 60 variants plus a 1,000-character description and three options of 30 values ≈ 22.3 KB. The validator samples are the proof; if a sample exceeds 24 KB, the implementer escalates instead of cutting another field.
- **Currency**: verify that every product is created in the store currency (`createProductRequestSchema.currency` comes from the client); the customer link condition already excludes a mismatch.
- **Plugin**: verify on 1.7.14 that `hooks.before` on `/oauth2/authorize` runs before the client is read, and that a client with `scopes` updated in place accepts the new scope (T1 integration test).
- **Collation**: `es-x-icu` must exist in the test and production databases, as the app list already requires.
- **`unaccent`**: the public catalog's extension; `unaccent(lower(sku))` on a null SKU is null and does not match.
- Not designed: price or stock sorting, description search, photos, a configurable threshold, margins.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1 (parallel):  T1 Consent, scope and outdated connections
                    T2 Language rule and per-module failure text
                    T3 Product search and detail reads (features/products)
Wave 2:             T4 Product tool module (depends on T1, T2, T3)
Final verification  (after T4)
```

Files per task are those of section 12; tasks of the same wave share none. `assistant-tools.test.ts` is edited by T2 (wave 1) and T4 (wave 2) only.

### T1. Consent, scope and outdated connections

**Scope:** `products:read` in `assistantScopes`; `connectionEndReason` and the scope rule in `isConnectionActive`; `consent_outdated` in `resolveAssistantAccess` and `endConnection`; `authorizeAssistant` saving every scope; `alignClientScopes` in the `/authorize` hook; consent and settings texts of the product draft in `app/locales.ts` (es, pt) and the two new «Podrá ver» lines in `assistant-authorize.tsx`; updated scope strings in existing assistant tests; the E2E text.
**Out of scope:** any tool, the server instructions, `tool-registry.ts`, `features/products`.
**Acceptance criteria:**
1. A connection stored with `scopes = {orders:read}` and used yesterday is not listed in «Asistentes de IA»; its next `POST /mcp` answers `401` and logs `assistant_access_refused` with `consent_outdated`; its row is gone and its tokens revoked.
2. That agent's `/authorize` with its original client shows the authorization screen (no `invalid_scope`), whose title reads «ChatGPT quiere leer los pedidos y productos de Tienda Rosa»; **Permitir acceso** leaves one row with both scopes.
3. A new registration and authorization yield tokens with `orders:read products:read offline_access`; the metadata advertises them.
4. `/pt-BR/assistants/authorize` shows the Portuguese texts of the product draft's Screens table.
**Tests:** the T1 titles of section 14 (assistant-connection, resolve-assistant-access, authorize-assistant, oauth-hooks, assistant-lifecycle, oauth-metadata-routes, E2E).
**Depends on:** nothing.

### T2. Language rule and per-module failure text

**Scope:** `generalInstructions` and `orderToolsInstructions` texts; `ToolModule.readFailureMessage` and its use in `render`; the order module sets it; `checkToolModules` language and empty-failure-text violations; the fixture module in `assistant-tools.test.ts` gets the field.
**Out of scope:** scopes, consent texts, product code.
**Acceptance criteria:**
1. The server instructions of a connection contain the owner's-language rule and no «en español»; `checkToolModules(toolModules)` is empty.
2. A module whose description says «responde en español» is reported by `checkToolModules`.
3. A fixture module with `readFailureMessage: "No pudimos leer tus productos…"` whose run throws answers that text; the order tools keep answering «No pudimos leer tus pedidos…».
**Tests:** the tool-registry and server-instructions titles of section 14; the existing validator stays green.
**Depends on:** nothing.

### T3. Product search and detail reads

**Scope:** `stock-level.ts`, `product-search.ts`, `search-for-assistant.ts`, `find-for-assistant.ts`, `product-search-repository.ts` with row schemas and `product_search_failed`, `products.searchForAssistant` and `products.findForAssistant` in `composition.ts`, `PRODUCT_SEARCH_STATEMENT_TIMEOUT_MS`, the performance seed and the check of section 7.3.
**Out of scope:** Spanish texts, MCP schemas, the app product list and its contract, catalog settings.
**Acceptance criteria:**
1. With the product draft's store (Polo básico M / Azul S/ 39.90 stock 2, L / Rojo S/ 45.00 stock 10; Casaca M / Azul S/ 120.00 stock 0), values «azul» and «m» return both products with M / Azul; adding `in_stock` returns only Polo básico.
2. `priceFrom` 4000 and `priceTo` 13000 cents return Polo básico through L / Rojo and Casaca through M / Azul.
3. A store with values Azul, Azul claro, Negro, Rojo and S, M, L rejects «Celeste» with a vocabulary whose sizes read S, M, L; «Verde» held only by deactivated variants is rejected.
4. 45 matching products page as 20, 20, 5 with total 45.
5. `findForAssistant({ by: "sku", sku: "pol-m-az " })` opens Polo básico with M / Azul as the searched variant.
6. The plans and timings of section 7.3 meet the criteria and are recorded for the pull request.
**Tests:** the products unit and integration titles of section 14.
**Depends on:** nothing.

### T4. Product tool module

**Scope:** `catalogStorefront.describe`; `product-projection.ts`; `products-tools.ts` and `products-texts.ts` with the product draft's descriptions (no categories, «polo» and «casac» literally, purchase price not for customers and no margins, stock is the current count, mention a hidden catalog once), inputs, outputs, messages and sample outputs at maximum lengths; `assistant-product-capabilities.ts`; the entry in `assistant-tools.ts`; validator and MCP integration tests.
**Out of scope:** changes to scopes, access, registry, instructions of the order module, `features/products` queries.
**Acceptance criteria:**
1. A connection with both scopes lists six tools; the validator passes with the four budget cases of section 14.
2. Acceptance criteria 1–17, 20, 21 and 23 of the product draft pass through the MCP client in `products-tools.integration.test.ts` or the unit tests named in section 14.
3. A read failure answers «No pudimos leer tus productos en este momento. Inténtalo de nuevo en unos segundos.» and logs `assistant_tool_failed` once.
**Tests:** product-projection, products-tools, validator, catalog-settings-repository and products-tools integration titles of section 14.
**Depends on:** T1 (`products:read` literal), T2 (`readFailureMessage`, language checks), T3 (composed operations).

### Final verification

`scripts/ci.sh` green on the integration branch; the manual checks of section 14 with Claude and ChatGPT against a preview, in Spanish and Portuguese; the performance plans of T3 in the pull request; the pull request warns that existing connections, the founder's included, must be connected again.

## 17. Open items and questions

```
Questions (answer with the option number):

1. Ending connections at release: does the rule apply only to products:read or to every data scope Yoyos adds later?
   (1) Every scope. Recommended: one predicate (a connection must hold every current data scope) ends orders-only connections now,
       and MCP 3/4 and 4/4 get the same release behavior just by adding their literal; a branch that wants otherwise changes the predicate.
   (2) Only products:read. The predicate names the literal; MCP 3/4 and 4/4 each decide and edit it, and forgetting to do so would
       let an older connection keep working without the new tools and without ever seeing their consent.

Decided unless objected:
- Old connections are ended lazily through `isConnectionActive` (hidden from the list at once, deleted and revoked on their next call,
  consent dropped on the next /authorize); no data migration, since there is no production data.
- The /authorize hook aligns each registered client's stored scopes with the current set, so agents re-authorize with their own client.
- The search filters stay internal to features/products (`ProductSearchCriteria`); `productListQuerySchema` does not change until the app list uses them.
- `lowStockThreshold = 3` is a constant in products/domain/stock-level.ts, passed to SQL as a parameter; MCP 4/4 reuses it.
- Text search ignores accents as well as case (`unaccent(lower(…))`), on the name and any SKU, so it is more lenient than the app list's ILIKE.
- Value matching normalizes in TypeScript and filters by option-value ids in SQL; no SQL normalizer.
- No new index: company-leading access on existing indexes, checked with EXPLAIN on a 2,000-product seed (under 150 ms per statement, initial value).
- Statement timeout of 2,000 ms on product reads (PRODUCT_SEARCH_STATEMENT_TIMEOUT_MS, adjustable).
- Output maxima as in MCP 1/4: names 100, combinations 50, SKUs 40 in search lists; Ver producto shows SKUs and option values whole.
- The customer link also requires the product currency to equal the store currency, the public catalog's own filter.
- Reading-failure text per tool module; the validator refuses «en español» and «tal cual» in any module's texts.
- A token minted before re-authorization keeps only its own scopes until it expires.
```
