# Read-only MCP server for orders: technical design

**Status:** design closed, pending implementation. The review gate and the coordinator decided the questions in section 17; the founder confirms them in the pull request. Gate history in section 19. Based on [mcp-read-only-server.md](mcp-read-only-server.md) (Todoist `6hrqGV7M6QG42J53`, MCP 1/4). Base: `jorgeluis594/mcp-1-4-servidor-mcp-remoto-de-solo-lect` at `a8e8820f`.

## 1. Technical goal

Core serves one remote MCP endpoint, `https://app.yoyos.lat/mcp`, over streamable HTTP. An agent discovers the Yoyos authorization server from the endpoint's `401`, registers itself, sends the owner's browser through the Yoyos sign-in and authorization screen, and receives a short-lived JWT access token bound to that resource plus a refresh token. Each tool call resolves the token into the same `ReadyAccess` and tenant context that cookies and mobile JWTs produce, checks that the store's connection is still active, applies the per-store limit, calls the orders feature's composed operations inside `withTenantIsolation`, and returns a masked projection. The owner sees and ends connections on the web page «Asistentes de IA».

```text
Agent (ChatGPT, Claude)                     Yoyos core (Express, one process)
  │ POST /mcp (no token) ───────────────────▶ 401 WWW-Authenticate: resource_metadata=…/.well-known/oauth-protected-resource/mcp
  │ GET /.well-known/oauth-protected-resource/mcp, /.well-known/oauth-authorization-server
  │ POST /api/auth/oauth2/register (DCR) ────▶ hook: https or loopback redirect URIs only → oauthClient row
  │ browser → /api/auth/oauth2/authorize ───▶ hook: normalize scope; drop stored consent without active connection
  │                                            → /login?<signed query> → /assistants/authorize (React Router)
  │                                            «Permitir acceso» → plugin consent → AssistantConnection row (company RLS) → redirect with code
  │ POST /api/auth/oauth2/token (PKCE, resource=…/mcp) ▶ JWT access token (aud …/mcp) + refresh token
  │ POST /mcp  Bearer <JWT> ────────────────▶ verify JWT (cached JWKS) → coarse limiter → loadUserAccess → withTenantIsolation(company)
  │                                            → active AssistantConnection → store limiter → «Último uso» → tool → orders → mask → result
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Scope of this version | Remote MCP server, OAuth authorization server, `AssistantConnection` table, four read-only order tools, masking, per-store limiter, per-call log, authorization screen and web page «Asistentes de IA». No mobile change, no write tool. |
| MCP library | `@modelcontextprotocol/server` 2.x (stable v2 line) with `@modelcontextprotocol/node` for `toNodeHandler`; `@modelcontextprotocol/client` 2.x as a devDependency for the validator. `@modelcontextprotocol/express` is not added: its bearer middleware does not know Yoyos connections and its host validation is for localhost servers. |
| Transport entry point | `createMcpHandler(factory)` mounted with `toNodeHandler`. It serves the 2026-07-28 revision natively and 2025-era clients (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05) through its default stateless legacy fallback, so ChatGPT and Claude work whichever revision they speak. The SDK passes `req.auth` as its `AuthInfo` type (`token`, `clientId`, `scopes`, `expiresAt`, `resource`, `extra`): `mcp-routes` sets `extra.assistantAccess` to the resolved `AssistantAccess`, and the factory reads it only through `assistantAccessOf(authInfo)`, which checks it with a strict schema and fails the request (`500`, logged) if it is missing, so no cast is needed. The factory builds an `McpServer` from tool definitions and JSON Schemas computed once at startup per scope set. No session state, no server-initiated streams: `subscriptions/listen` is not offered, and `GET` and `DELETE` on `/mcp` answer what the handler answers for a server without streams (`405`). Reason: every call is an independent read; nothing is lost on deploy. |
| Mount point | `/mcp` on the core Express app, outside `/api`, before React Router, with its own `express.json({ limit: "100kb" })`. Reason: `/api` treats any `Authorization` header as a mobile JWT and answers `401` when it is not one; the MCP bearer must never pass through that chain, and `/mcp` never reads cookies. |
| Authorization server | Better Auth's `@better-auth/oauth-provider` plugin (the MCP and OIDC provider plugins of `better-auth` itself are gone in 1.7). It provides RFC 8414 metadata, RFC 7591 dynamic client registration, authorization code with PKCE (`S256`), refresh-token rotation, RFC 8707 resource indicators, revocation and a custom consent page. Yoyos adds one Better Auth `hooks.before` dispatcher (section 5.11), the `validateRedirectUri` option and a `disabledPaths` list around it; the OAuth protocol itself is the plugin's. The Better Auth set moves together: `better-auth` and `@better-auth/expo` `^1.7.14`, `better-call` `1.4.4`, `@better-fetch/fetch` `1.3.3` (peer requirements of the plugin and of `@better-auth/expo` 1.7.14). |
| Client registration | Open dynamic client registration (`allowDynamicClientRegistration: true`, `allowUnauthenticatedClientRegistration: true`), public clients (`token_endpoint_auth_method: "none"`), redirect URIs limited to `https` with a non-loopback host or `http` loopback (`127.0.0.1`, `[::1]`, `localhost`). Custom schemes are refused at registration and at authorization. At `/authorize` a redirect URI must be registered for that client **and** allowed: `validateRedirectUri(uri, registered, defaultResult)` returns `defaultResult && isAllowedRedirectUri(uri)`, because the plugin uses the callback's answer instead of its own registration match. A `scope` sent at registration is replaced by `orders:read offline_access`, so an agent registering with `openid profile email` is not refused before it reaches the screen. Decided by the review gate (section 17). |
| Unused plugin endpoints | Better Auth's `disabledPaths` turns off every plugin endpoint this version does not use, so they answer `404` over HTTP: `/oauth2/create-client`, `/oauth2/update-client`, `/oauth2/delete-client`, `/oauth2/client/rotate-secret`, `/oauth2/client/rotate-keys`, `/oauth2/get-client`, `/oauth2/get-clients`, `/oauth2/public-client`, `/oauth2/public-client-prelogin`, `/oauth2/get-consent`, `/oauth2/get-consents`, `/oauth2/update-consent`, `/oauth2/delete-consent`, `/oauth2/continue`, `/oauth2/userinfo`, `/oauth2/introspect`, `/oauth2/end-session`, `/oauth2/end-session/confirm`, and `/.well-known/openid-configuration`. The `/admin/oauth2/*` endpoints are not listed: they are `SERVER_ONLY`, so the router never serves them, and `disabledPaths` is an exact path match that cannot cover their path parameters (the 1.7.14 endpoint list, read from the package; T0 re-reads it after install). Only `register`, `authorize`, `token`, `revoke` and `consent` (server-side, section 5.11) stay. Reason: without it any signed-in Yoyos user could create clients through `create-client`, outside the registration hook and its rate limit; open registration keeps a single, limited entry. |
| OAuth endpoint rate limits | Better Auth's rate limiter configured on purpose for the plugin paths, per client IP, in memory: `/oauth2/register` 5 per minute, `/oauth2/authorize` 30 per minute, `/oauth2/token` 300 per minute (agents refresh from shared egress IPs for every store). Initial values, adjustable. The client IP comes from `x-forwarded-for` (`advanced.ipAddress.ipAddressHeaders`) with `advanced.ipAddress.trustedProxies` set to the deployment's proxy hops: Better Auth 1.7.14 trusts only a single-value header without it, so a chain (`client, proxy`) resolves to no IP and every such request shares one bucket per path, and a header the client sends through an appending proxy would let it pick its own bucket. T0 records the header shape Coolify's proxy really sends and tests a client-supplied `x-forwarded-for`. |
| Scopes | A connection always holds `orders:read` and `offline_access`. The authorize hook normalizes the requested `scope` to exactly `orders:read offline_access`, whatever the agent asked (`openid`, `profile`, nothing, or only `offline_access`), because the consent screen lists what this version reads and `offline_access` keeps the refresh token alive when the owner signs out (product: signing out does not disconnect). No OpenID scopes: Yoyos is an OAuth server here, not an OpenID provider. |
| Resource | One protected resource, identifier `${BETTER_AUTH_URL}/mcp`, seeded through the plugin's `resources` option and linked to every registered client (`clientRegistrationDefaultResources`). Access tokens are JWTs (`typ` `at+jwt`, `alg` `EdDSA`) with `aud` equal to that identifier, signed by the existing `jwt` plugin keys. |
| Token lifetimes | Access token 1 hour (`ASSISTANT_ACCESS_TOKEN_TTL_SECONDS=3600`), refresh token 90 days with rotation, authorization request 10 minutes, rotated refresh token reusable for 10 seconds (`refreshTokenReuseInterval`, `ASSISTANT_REFRESH_REUSE_SECONDS=10`; the plugin's default 0 treats any reuse as replay and revokes the grant, which an agent that refreshes concurrently or retries after a dropped response would trip while its connection stays listed as connected). The request lifetime is the plugin's `codeExpiresIn` (`ASSISTANT_AUTHORIZATION_REQUEST_TTL_SECONDS=600`): the plugin signs the query with a fresh `exp = now + codeExpiresIn` on every redirect to the sign-in or the authorization screen, so the 10 minutes run from the last redirect to the screen (after signing in, a new window starts), which is the product's «más de 10 minutos en esta pantalla»; sign-in time does not count. Initial values, adjustable. Token lifetime never decides whether a connection is active; the `AssistantConnection` row does. |
| Connection identity | One `AssistantConnection` per (store, OAuth client, authorizing account). The access token carries `sub` (user) and `azp` (client); core resolves the connection from those two plus the user's company. Re-authorizing the same client by the same account while its connection is active changes nothing: the plugin issues a code without showing the screen and the row keeps its dates. When the agent forces the screen (`prompt=consent`), allowing again also keeps the active row as it is (name, dates and «Último uso»). Decided by the review gate (section 17). |
| Screen guarantee | No active connection for (client, account) ⇒ the Yoyos authorization screen is shown. The authorize hook deletes any stored `oauthConsent` of that client and account that has no active connection before the plugin looks it up, except in the authorize nested in the owner's own **Permitir acceso** (marked by the Yoyos consent marker, so the first tap returns a code); the plugin's consent endpoint answers only under that marker (only the Yoyos action calls it, server-side). |
| Ended connections | Deleted, not kept. Disconnecting, 90 days without use and password reset delete the row and revoke the client's refresh and access tokens and its stored consent for that account. Revocation is cleanup; the screen guarantee does not depend on it. |
| 90-day inactivity | Evaluated when read: a connection whose `coalesce(lastUsedAt, authorizedAt)` is 90 days or older is ended by the next tool call (which is refused) and hidden from the list. No scheduled job. `ASSISTANT_CONNECTION_INACTIVITY_DAYS=90`, initial value, adjustable. |
| Password reset | Two mechanisms. The guarantee: a connection is active only while its `authorizedAt` is later than the authorizing account's last password change (the credential `account.updatedAt`), checked on every tool call and in the list. The cleanup: Better Auth's native `emailAndPassword.onPasswordReset` deletes that account's connections and revokes their grants; if it fails it logs `assistant_password_reset_cleanup_failed` (error) and the guarantee still refuses the next call. The native reset stays as it is. |
| Tenant resolution | The MCP bearer resolves through `loadUserAccess(userId)`, the same loader the cookie and mobile JWT paths use, then `withTenantIsolation(companyId)`. The token carries no company; RLS applies to every read. |
| Token verification | `alg` pinned to `EdDSA`, `typ` to `at+jwt`, `iss` to `BETTER_AUTH_URL`, `aud` to the MCP resource, strict claim schema (`sub`, `azp`, `client_id`, `scope`, `iss`, `aud`, `iat`, `exp`, `jti`, optional `sid`), lifetime ≤ `ASSISTANT_ACCESS_TOKEN_TTL_SECONDS`. `sid` is not checked against a live session (the token outlives sign-out by design). Keys come from the existing JWKS cache in `jwt-verifier.ts`, extracted so both verifiers share it, with forced refreshes on an unknown `kid` throttled to one per 30 seconds. |
| Order reads | Tools call the orders feature's composed operations (`orders.listAggregates`, `orders.hasAny`, `orders.getAggregateByNumber`, `orders.describeDispatchStock`, `orders.listDispatchQueue`, `orders.summarizeUnpaid`), never REST endpoints. The unconfirmed-catalog exclusion stays in the orders repository and composition. |
| Dispatch queue read | Classified on light rows (the existing `StockOrder` shape plus number, date, delivery method and pending report) served by a new partial index; full aggregates are loaded only for the 20 orders on the page. Safety ceiling 5 000 candidates (`ASSISTANT_DISPATCH_QUEUE_MAX=5000`, initial value): above it the read fails with the product's reading-failure text and a warn log. |
| Readiness | A pure orders domain function `describeDispatchReadiness` built on `orderFulfillmentBlock` plus one extra rule (partially paid, not due, short at current stock). Its sentences are the web's `orderFulfillment` texts in `apps/core/app/locales.ts` (Spanish), so the tool and the button never drift. |
| Masking | A pure projection, `toAssistantOrder` and `toAssistantOrderSummary` in `features/assistants/domain/order-projection.ts`, is the only code that reads buyer, recipient and destination data. Tool output schemas are `z.strictObject` and have no phone, street, reference or document field. A name made of a phone number is treated as no name, and long digit runs in any returned name are masked. |
| Limits | Store limit: 60 `tools/call` per minute per company, fixed one-minute window (`ASSISTANT_TOOL_CALL_LIMIT=60`). Coarse limit: 300 `POST /mcp` per minute per (account, client), checked right after JWT verification and before any database read (`ASSISTANT_REQUEST_LIMIT=300`). Both in process, through a shared fixed-window limiter extracted from `catalog/presentation/rate-limit.ts`. Initial values, adjustable. |
| «Último uso» | Updated on every `tools/call` that reaches a store (limit and invalid-input refusals included). Skipped in process when the loaded `lastUsedAt` is in the current clock minute; otherwise one conditional `UPDATE` in its own short transaction. |
| Per-call log | One `assistant_tool_called` info line per `tools/call` with company, connection, tool, outcome and duration; never inputs or outputs. |
| Tool output | Each tool returns `structuredContent` validated against its output schema and one text block with the same JSON, compact. Amounts, dates and states come as display strings («S/ 120.00», «30/10/2026», «Pago pendiente»). Budget: the JSON is at most 24 KB per response, checked by the validator on a twenty-order list page and on a `ver_pedido` order with 60 item lines and 10 payments at maximum-length names; the text block repeats it, so a response carries about twice that. `ver_pedido` lists every line of the order (no cap); an order beyond the budget still answers, and the validator case shows the margin. Business refusals (not found, invalid input, limit) are tool results with `isError: true` and a Spanish `message`; only authorization failures are HTTP `401`. |
| Tool registration | Tools are grouped in `ToolModule`s, one per data category, each declaring its scope and `access: "read"`. `src/composition/assistant-tools.ts` lists the modules; MCP 2/4–4/4 each add one module file and one entry there. |
| Static validator | A unit test, `src/composition/assistant-tools.test.ts`, connects an MCP client to the in-process server over the SDK's in-memory transport and validates every registered tool's definition and sample outputs (section 14). It runs in `test:unit` and alone with `pnpm --dir apps/core mcp:validate`. The live check is MCP Inspector, in the founder guide. |
| Web | React Router routes `assistants/authorize` (authorization screen, public layout, framing forbidden) and `settings/assistants` (private layout, Settings navigation after «Catálogo»), in both unprefixed and `:locale` trees. The login form follows the OAuth continuation instead of `/dashboard` when the URL carries a signed authorization query. |
| Feature | New core feature `features/assistants` («Asistentes de IA»): connections, access resolution, projection and tools. Cross-feature wiring of the MCP server lives in `src/composition/assistant-server.ts`. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Express app and mount order | `apps/core/src/app.ts` | `/health`, `requestLogging`, `brandHostEdge`, `app.all("/api/auth/{*splat}", toNodeHandler(auth))`, per-prefix `no-store`, body parsers, `/api` → `loadApiAccess` → `requireApiCompany` → feature routers. React Router is mounted last in `src/server.ts`. |
| Better Auth | `apps/core/src/shared/infrastructure/auth.ts` | `better-auth` 1.7.5, Prisma adapter on `systemPrisma`, email and password with verification (`requireEmailVerification: true`, `autoSignIn: false`: an unverified account gets no session) and native reset (`revokeSessionsOnPasswordReset: true`), plugins `expo()` and `jwt()` (issuer `BETTER_AUTH_URL`, audience `yoyos-core-api`, 15 minutes, payload `{ sid }`). No hooks, no OAuth provider, rate limiter at its defaults (on in production only). |
| Access resolution | `src/shared/infrastructure/current-user.ts` (`resolveCurrentAccess`), `jwt-verifier.ts` (`authenticateJwt`, EdDSA, strict claims, `aud` `yoyos-core-api`, ≤ 900 s, live session check, JWKS cached 60 s and reloaded on any unknown `kid` without throttle), `features/users/application/load-user-access.ts` (`loadUserAccess`), `user-access.ts` (`UserAccess` = `verification_required` / `company_required` / `ready`) | Cookies and mobile JWTs resolve the same `UserAccess`; a present but invalid `Authorization` answers `401` on `/api`. |
| Credential account | `prisma/schema.prisma` `Account` (`@@map("account")`) | `password` and `updatedAt @updatedAt`; Better Auth updates the credential row when the password is reset. |
| Tenant isolation | `src/shared/infrastructure/persistance.ts`, `docs/rls-with-prisma.md` | `withTenantIsolation`, tenant `prisma` extension setting `app.company_id` in one short transaction per statement, `systemPrisma` for auth tables, `withinTransaction`, `withinReadSnapshot`. Runtime role `core_app` (DML only, no `BYPASSRLS`); default privileges grant DML on new tables. |
| Order list use case | `features/orders/application/list-order-aggregates.ts` | `listOrderAggregates(criteria, OrderAccess, find)`; `AggregateCriteria` has `search`, `view` (`all`/`unpaid`/`undelivered`), created dates, `deliveryStatus`, `courierId`, `scheduled`, shipped dates, 20 per page, newest first. |
| Order list query | `features/orders/infrastructure/order-repository.ts` `findOrderAggregates` | Excludes unconfirmed catalog orders (`NOT (fromCatalog AND checkoutConfirmedAt IS NULL)`). Search matches buyer name, **buyer phone** and `#number`. Cancelled orders are included unless `deliveryStatus` is `pending` or a view excludes them. Ids and `count(*)` first, then the 20-row include load. |
| Order indexes | `prisma/schema.prisma` `Order` and migrations | `(companyId, number)`, `(companyId, id)`, `(companyId, completedAt DESC, id)`, `(companyId, chatId)`, partial `Order_undeducted_pending_idx (companyId, createdAt, id) WHERE NOT stockDeducted AND NOT cancelled AND deliveryStatus = 'pending'`. None serves `scheduledDispatchDate`. |
| Order detail | `read-order-aggregate.ts` `getOrderAggregate`, repository `findOrderAggregate` wrapped by `rejectPendingCatalogOrder` in `orders/composition.ts` | By UUID only; no lookup by number. |
| Stock due | `application/describe-order-stock-due.ts`, `orders.describeStockDue`; `domain/stock-deduction.ts` (`StockOrder`, `toStockOrder`, `isStockDeductionDue`, `describeStockDue`) | Batched `stockDue` for due orders only; reads stock once per batch. `StockOrder` holds id, created date, cancelled, deducted, delivery status, total, item lines and confirmed payments. |
| Readiness rule | `shared/orders-fulfillment.ts` `orderFulfillmentBlock` | Used by web order detail and mobile. Does not cover a partially paid, not-due order with short stock (its button stays enabled). |
| Readiness texts | `apps/core/app/locales.ts` `orderFulfillment` | `SHIP_PAYMENT_REQUIRED`, `PAYMENT_REQUIRED`, `STOCK_WAITING_ship`, `STOCK_WAITING_deliver`, `STOCK_DEDUCTING` in Spanish and Portuguese. |
| Couriers of a store | `features/delivery-settings/composition.ts` `deliverySettings.getForCompany` | Returns the store's couriers, disabled included, but reads the settings row `FOR SHARE` inside a transaction. Mobile's courier filter uses the same list through the API. |
| Lima days | `shared/orders-date.ts` (`salesTimeZone`, `limaMidnightUtc`, `nextCalendarDay`), `shared/dispatch-date.ts` | Day filters already use inclusive Lima days. No helper returns today's Lima date from a clock. |
| In-memory limiter | `features/catalog/presentation/rate-limit.ts` `createRateLimiter` | Fixed window per key in a `Map`, sweeps every key on every call, returns `boolean`; no retry-after. |
| Logger | `src/shared/infrastructure/logger.ts`, `docs/logging.md` | Pino `log`, `requestId` and `companyId` mixins, `bindCompanyToRequest`, redaction of tokens and headers. |
| Web settings pages | `apps/core/app/routes.ts`, `app/routes/private-layout.tsx`, `app/private-access.ts` | Private routes read `ReadyAccess` from `privateUserContext`; Settings nav ends with «Catálogo» (`settings/catalog`). React Router actions check the request origin (the `trust proxy` comment in `app.ts`). |
| Login form | `apps/core/app/components/auth-form.tsx` | After sign-in always navigates to `/dashboard`. |
| Frame protection | — | No `frame-ancestors` or `X-Frame-Options` anywhere in core. |
| MCP or OAuth code | — | None. No `@modelcontextprotocol/*` or `@better-auth/oauth-provider` dependency. |

## 4. Gaps this design closes

1. No authorization server for third-party agents (sections 5.11, 7.2).
2. No connection concept, table or page (sections 6, 7.1, 5.1–5.4, 10).
3. No way to turn an MCP bearer into `ReadyAccess` without weakening the cookie and mobile paths (section 5.5).
4. No MCP transport, tool registry or validator (sections 9, 12, 14).
5. No order lookup by number and no cheap "store has orders" check (section 5.6).
6. Order search cannot exclude the phone; no «pagado» filter; cancelled orders cannot be excluded outside the existing views (section 5.7).
7. No unpaid summary over every unpaid order (section 5.8).
8. No dispatch queue with readiness, overdue grouping and the partial-paid short-stock rule, and no index for it (sections 5.9, 7.4).
9. No helper for today's Lima date (section 5.9).
10. No lock-free read of a store's couriers (section 5.12).
11. The limiter returns no seconds left and lives inside catalog (section 9.4).
12. Login does not continue an OAuth authorization; the authorization screen has no frame protection (section 10).

## 5. Use cases

All `features/assistants` use cases take `(input, access, deps)`; every dependency returns `Result`; errors carry a literal `code`.

### 5.1 `authorizeAssistant` (assistants, new)

The owner taps **Permitir acceso**.

```ts
export type AuthorizeAssistantInput = Readonly<{ request: SignedAuthorizationRequest }>;
export type AuthorizeAssistantError = Readonly<{ code: "REQUEST_INVALID" | "REQUEST_EXPIRED" | "AUTHORIZATION_UNAVAILABLE" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type AuthorizeAssistantDependencies = Readonly<{
  readRequest: (request: SignedAuthorizationRequest, now: Date) => Promise<Result<AuthorizationRequest, AuthorizeAssistantError>>;
  acceptRequest: (request: SignedAuthorizationRequest, grant: Readonly<{ oauthClientId: OAuthClientId; userId: UserId }>) => Promise<Result<RedirectUrl, AuthorizeAssistantError>>;
  saveConnection: (connection: NewAssistantConnection) => Promise<Result<"inserted" | "reactivated" | "unchanged", AuthorizeAssistantError>>;
  generateId: () => AssistantConnectionId;
  clock: () => Date;
}>;
export async function authorizeAssistant(input: AuthorizeAssistantInput, access: AssistantOwnerAccess, deps: AuthorizeAssistantDependencies): Promise<Result<RedirectUrl, AuthorizeAssistantError>>
```

`AssistantOwnerAccess = Readonly<{ companyId: CompanyId; userId: UserId }>`, built only from `ReadyAccess`.

1. `readRequest` checks the signature first with `verifyOAuthQueryParams` (which returns one boolean for signature and expiry together); when it fails, it parses the query's `exp` itself: a well-formed query whose `exp` is past answers `REQUEST_EXPIRED`, anything else `REQUEST_INVALID`. The same mapping applies when the request expires between `readRequest` and `acceptRequest`: the plugin's query check answers `invalid_signature`, and `acceptRequest` turns it into `REQUEST_EXPIRED` when the query's `exp` is past. With a valid signature it loads the registered client (client id, declared name, redirect URIs) and checks that the request's redirect URI is registered and passes `isAllowedRedirectUri` (section 6); otherwise `REQUEST_INVALID`.
2. Build `NewAssistantConnection`: `agentName` = `parseAgentName(client_name)`, `returnTarget` = `returnTargetOf(redirectUri)` (section 6), `scopes` = `["orders:read"]` (the authorize hook already normalized the request), `authorizedAt` = clock.
3. `acceptRequest` calls the plugin's consent endpoint server-side, inside the **Yoyos consent marker** for (client, user) (section 5.11), as `auth.api.oauth2Consent({ body: { accept: true, oauth_query }, headers, request, asResponse: false })`:
   - `request` is a `Request` built for `${BETTER_AUTH_URL}/api/auth/oauth2/consent` (method `POST`, JSON body equal to `body`, the owner's `cookie` header). It is required: in 1.7.14 the nested authorize inherits the consent call's context and `authorizeEndpoint` throws `UNAUTHORIZED` «request not found» without `ctx.request` (review gate r3, B1). It is built rather than reusing the action's request so the plugin's endpoint URLs (`getEndpointUrl` reads the request path) resolve under `/api/auth` and no consumed form body is read.
   - `headers` carries the same `cookie`, which the plugin's session middleware reads.
   - `asResponse: false` is explicit, because passing a `request` turns responses on by default; the answer is the plugin's `{ redirect: true, url }` object (the consent endpoint asks the nested authorize for JSON), parsed with a strict schema.
   - It returns the redirect URL carrying the code. The consent endpoint writes `oauthConsent` and then dispatches `/oauth2/authorize` again inside the same call; the marker tells the hook dispatcher that this nested authorize belongs to the owner's tap, so the fresh consent is kept and the plugin returns the code on the first tap.
4. `saveConnection` runs one tenant transaction: `INSERT … ON CONFLICT ("companyId", "oauthClientId", "authorizedByUserId") DO NOTHING RETURNING id`; a returned id → `inserted`; no id (the row existed, or a concurrent first tap inserted it a moment ago) → `SELECT … FOR UPDATE` of that row and: an ended row (inactive or authorized before the last password change, still stored) → update `agentName`, `returnTarget`, `scopes`, `authorizedAt` and clear `lastUsedAt` (`reactivated`); an active row → nothing changes (`unchanged`), which happens only when the agent forced the screen with `prompt=consent` or on a double tap. A double tap leaves one row.
5. Return the redirect URL. The code reaches the agent only through this redirect, so the row exists before the agent can exchange the code. If step 4 fails, the page shows «No pudimos enviarlo…» and never redirects; the issued code expires unused and the stored consent is dropped by the authorize hook on the next attempt, because no active row exists.

Step 3 runs before step 4 so an expired or rejected request never leaves a row (product: «no connection is created»).

### 5.2 `denyAssistant` (assistants, new)

Input `{ request }`, same access. `readRequest` validates; `rejectRequest` calls the consent endpoint server-side under the same Yoyos consent marker and with the same built `request` and `asResponse: false`, with `accept: false`, and returns the plugin's redirect URL with `error=access_denied` (the plugin answers deny without a nested authorize). Writes nothing.

### 5.3 `listAssistantConnections` (assistants, new)

Input `{}`, access `AssistantOwnerAccess`, deps `findConnections(companyId)` (rows with each authorizing account's password change time, read in two queries: the connection rows under RLS, then one `systemPrisma` read `account WHERE "userId" = ANY($ids) AND "providerId" = 'credential'` served by `account (userId)`; never one read per row), `clock`, `inactivityDays`. Returns active connections (`isConnectionActive`, section 6) newest `authorizedAt` first. Inactive rows are filtered, not deleted here.

### 5.4 `disconnectAssistant` and `endAccountAssistantConnections` (assistants, new)

```ts
export type DisconnectAssistantInput = Readonly<{ connectionId: AssistantConnectionId }>;
export type DisconnectAssistantDependencies = Readonly<{
  deleteConnection: (id: AssistantConnectionId, companyId: CompanyId) => Promise<Result<EndedConnection | null, PersistenceError>>;
  revokeClientGrant: (grant: EndedConnection) => Promise<Result<null, Readonly<{ code: "REVOCATION_FAILED"; message: string }>>>;
}>;
```

1. `deleteConnection` deletes under RLS by id and company and returns `{ id, oauthClientId, authorizedByUserId }`, or `null` when no row matched (another tab already ended it, or another store's id): both answer success, as the product requires.
2. `revokeClientGrant` marks revoked every not-yet-revoked `oauthRefreshToken` and `oauthAccessToken` of that client and user (`AND revoked IS NULL`, so the up to ~2 000 rows rotation leaves behind are not rewritten) and deletes their `oauthConsent`, through `systemPrisma` (Better Auth tables are global). A revocation failure is logged (`assistant_grant_revocation_failed`, warn) and the use case still succeeds: the row is gone, so `/mcp` refuses the client's tokens, and the authorize hook drops the leftover consent the next time the agent asks.

`endAccountAssistantConnections({ userId })` runs from `onPasswordReset`: loads the user's company through `loadUserAccess`; if `ready`, deletes in that tenant every connection with `authorizedByUserId = userId` and revokes each grant. Connections of other accounts of the store are untouched. Any failure is logged once as `assistant_password_reset_cleanup_failed` (error) with `userId` and `errorCode`; it is not retried, because the password-change rule in `isConnectionActive` already refuses those connections on their next call and hides them from the list.

Any account of the store may disconnect any of its connections (no roles).

### 5.5 `resolveAssistantAccess` (assistants, new)

Runs on every `POST /mcp` after JWT verification and the coarse limiter.

```ts
export type VerifiedAssistantToken = Readonly<{ userId: UserId; oauthClientId: OAuthClientId; scopes: readonly AssistantScope[] }>;
export type AssistantAccess = Readonly<{ companyId: CompanyId; userId: UserId; connectionId: AssistantConnectionId; scopes: readonly AssistantScope[]; lastUsedAt: Date | null }>;
export type ResolveAssistantAccessError = Readonly<{ code: "NOT_AUTHORIZED"; reason: "not_ready" | "no_connection" | "inactive" | "password_changed" | "scope" } | { code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type ResolveAssistantAccessDependencies = Readonly<{
  loadUserAccess: (userId: UserId) => Promise<Result<UserAccess | null, ResolveAssistantAccessError>>;
  inTenant: <T>(companyId: CompanyId, work: () => Promise<T>) => Promise<T>;
  findConnection: (oauthClientId: OAuthClientId, userId: UserId) => Promise<Result<ConnectionWithPasswordChange | null, ResolveAssistantAccessError>>;
  endConnection: (connection: AssistantConnection) => Promise<Result<null, ResolveAssistantAccessError>>;
  clock: () => Date;
  inactivityDays: number;
}>;
```

1. `loadUserAccess(token.userId)`; anything but `ready` (deleted user, unverified, no company) → `NOT_AUTHORIZED` `not_ready`.
2. Inside `inTenant(access.company.id)`: `findConnection(client, user)` (one unique-index probe on `AssistantConnection` plus the credential account's `updatedAt` read through `systemPrisma`, filtered on `"providerId" = 'credential'`); `null` → `no_connection`.
3. `isConnectionActive` false → `endConnection` (delete + revoke, logged `assistant_connection_ended` with `reason` `inactive` or `password_reset`) → `inactive` or `password_changed`.
4. `scopes` = token scopes ∩ connection scopes; without `orders:read` → `scope`.
5. Return `AssistantAccess`. The request continues inside the same `withTenantIsolation` and `bindCompanyToRequest`.

Why it does not weaken the other paths: `/mcp` reads only `Authorization: Bearer` and never cookies; the MCP verifier requires `aud = ${BETTER_AUTH_URL}/mcp` and `typ` `at+jwt`, so a mobile JWT (`aud` `yoyos-core-api`) is refused; `authenticateJwt` requires `aud` `yoyos-core-api` and its strict claim schema, so an MCP token sent to `/api` is refused with `401`. Both paths end in `loadUserAccess`, and the company always comes from `User.companyId`.

### 5.6 `getOrderAggregateByNumber` and `hasAnyOrder` (orders, new)

`getOrderAggregateByNumber`: input `{ number: OrderNumber }`, access `OrderAccess` (`{ companyId, userId }`), deps `findOrderByNumber(number, companyId)`. Returns `OrderAggregate` or `ORDER_NOT_FOUND`. The repository function `findOrderAggregateByNumber` is wrapped by `rejectPendingCatalogOrder` in `orders/composition.ts` exactly as `findOrderAggregate`, so an unconfirmed catalog order answers `ORDER_NOT_FOUND`. Another company's number finds nothing under RLS and answers the same. Composed as `orders.getAggregateByNumber`.

`hasAnyOrder`: input `{}`, same access, deps `existsOrder(companyId)` (`SELECT EXISTS (… LIMIT 1)` with the catalog exclusion). Composed as `orders.hasAny`. Used only when a filtered search returns an empty first page.

`describeDispatchStock` (section 5.9) is also composed as `orders.describeDispatchStock` for one order, so `ver_pedido` reads `stockDue` and the current-stock shortfall in one snapshot and one stock read.

### 5.7 `listOrderAggregates` (orders, modified)

`AggregateCriteria` gains three optional fields; absent means today's behavior, so web and mobile callers do not change:

| Field | Meaning |
| --- | --- |
| `view: "paid"` | New value: not cancelled and confirmed payments ≥ total. |
| `cancelled?: "exclude"` | Adds `o.cancelled = false`. |
| `searchPhone?: "exclude"` | Assistant search, never by phone: a query that contains any digit searches the order number only («1001», «#1001»); a query with no digit searches the customer name. Digits never match a customer name, so a masked phone cannot be rebuilt by probing (decided by the coordinator after T4 review r2 (founder criterion: never a complete phone)). Web and mobile search is unchanged. |

Precedence: `view: "unpaid"` and `view: "paid"` always exclude cancelled orders, whatever `cancelled` says, because both are defined over not-cancelled orders (product vocabulary «Por cobrar»). In `buscar_pedidos`, `incluir_cancelados` therefore affects only searches without `pago`, and the tool description says so. The use case validates the new values like the existing ones.

### 5.8 `summarizeUnpaidOrders` (orders, new)

Input `{}`, access `OrderAccess`, deps `summarizeUnpaid(companyId)`. Returns `UnpaidSummary = Readonly<{ count: number; withPendingReport: number; owed: readonly Money[] }>` (one `Money` per currency present; a store has one in practice). Same predicate as `view: "unpaid"`, so the summary and the list agree. Balance = total − confirmed payments; reported payments do not reduce it. Composed as `orders.summarizeUnpaid`.

### 5.9 `listDispatchQueue` and `describeDispatchStock` (orders, new)

```ts
export type DispatchCandidate = StockOrder & Readonly<{
  number: OrderNumber; scheduledDispatchDate: DispatchDate;
  deliveryMethod: "home" | "agency" | "store" | null; hasReportedPayment: boolean }>;
export type ListDispatchQueueInput = Readonly<{ today: DispatchDate; page: PageNumber }>;
export type DispatchQueuePage = Readonly<{
  entries: readonly DispatchQueueEntry[];   // at most 20, in queue order
  page: PageNumber; total: number;
  summary: Readonly<{ overdue: number; overdueReady: number; today: number; todayReady: number }>;
  undatedPending: number;
}>;
export type DispatchQueueEntry = Readonly<{ group: "overdue" | "today"; order: OrderAggregate; readiness: DispatchReadiness }>;
export type ListDispatchQueueError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_ORDER" | "QUEUE_TOO_LARGE"; message: string }>;
export type ListDispatchQueueDependencies = Readonly<{
  inSnapshot: <T>(read: () => Promise<T>) => Promise<T>;
  findDispatchCandidates: (through: DispatchDate, max: number, companyId: CompanyId) => Promise<Result<readonly DispatchCandidate[] | "too_many", ListDispatchQueueError>>;
  readStock: (variantIds: readonly VariantId[]) => Promise<Result<VariantStock, ListDispatchQueueError>>;
  findAggregatesByIds: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly OrderAggregate[], ListDispatchQueueError>>;
  countUndatedPending: (companyId: CompanyId) => Promise<Result<number, ListDispatchQueueError>>;
  maxCandidates: number;
}>;
```

All reads of one call run in one `inSnapshot` (`withinReadSnapshot`), which is now short because the heavy load is 20 aggregates:

1. `findDispatchCandidates(today, maxCandidates + 1)`: light rows of not-cancelled, `deliveryStatus = 'pending'`, `scheduledDispatchDate <= today`, unconfirmed catalog orders excluded, served by `Order_dispatch_queue_idx` (section 7.4). Each row is the `StockOrder` fields (item lines and confirmed payments aggregated in SQL as JSON and parsed with a strict schema) plus number, date, `delivery ->> 'method'` and whether a `reported` payment exists. More than `maxCandidates` rows → `QUEUE_TOO_LARGE`, logged `dispatch_queue_too_large` (warn, `companyId`, `candidateCount`), answered by the tool with the product's reading-failure text. That text invites a retry the ceiling will not grant; it is kept because no store is near the ceiling and a distinct text is a product change (section 18).
2. `readStock` once for the variants of the candidates that need stock: due (`isStockDeductionDue`) or not deducted with at least one confirmed payment.
3. `classifyDispatchCandidate` (pure, section 6) per candidate: `stockDue` with the existing `describeStockDue(StockOrder, stock)`, the current-stock shortfall, and `describeDispatchReadiness`.
4. `orderDispatchQueue` (pure): group `overdue` (date < today) then `today`; inside each, ready then blocked; inside each part, oldest `scheduledDispatchDate` then lowest `number`. Summary counts come from all candidates; the page is the 20 of the single sequence.
5. `findAggregatesByIds` for those 20 only (names, buyer, delivery, payments for the projection).
6. `countUndatedPending`: not cancelled, pending, `scheduledDispatchDate IS NULL`, catalog exclusion, served by the same index.

`describeDispatchStock(orders: readonly OrderAggregate[])` runs steps 2–3 for full aggregates (through `toStockOrder`) and returns `ReadonlyMap<OrderId, DispatchStock>`; composed for `ver_pedido`.

`today` comes from `limaCalendarDay(clock())`, a new helper in `shared/orders-date.ts` (`Intl` with `salesTimeZone`). Composed as `orders.listDispatchQueue`.

### 5.10 `answerToolCall` (assistants, new)

The pipeline every `tools/call` goes through, in `features/assistants/application/answer-tool-call.ts`.

```ts
export type ToolCallOutcome = "answered" | "empty" | "rate_limited" | "invalid_input" | "not_found" | "failure";
export type AnswerToolCallDependencies = Readonly<{
  allowCall: (companyId: CompanyId) => LimiterDecision;           // { allowed: true } | { allowed: false; retryAfterSeconds: number }
  touchConnection: (id: AssistantConnectionId, now: Date) => Promise<Result<null, PersistenceError>>;
  clock: () => Date;
}>;
export async function answerToolCall<I, O>(tool: RegisteredTool<I, O>, rawInput: unknown, access: AssistantAccess, deps: AnswerToolCallDependencies): Promise<ToolAnswer<O>>
```

1. `allowCall(companyId)`.
2. `touchConnection` unless `access.lastUsedAt` is in the current clock minute (`sameMinute`, pure). It runs in its own short transaction, never around the tool's reads, so parallel calls of one agent do not queue on the row. A failure is logged and does not refuse the call. It runs for refused calls too (product: limit refusals update «Último uso»).
3. Refused in step 1 → `{ outcome: "rate_limited", retryAfterSeconds }`.
4. Validate `rawInput` with the tool's input schema and its `parseInput` (dates, ranges, page); failure → `invalid_input` with the field and remedy.
5. Run the tool's `run(input, access)`; its `Result` maps to `answered`, `empty`, `not_found` or `failure`. `PERSISTENCE_UNAVAILABLE`, `QUEUE_TOO_LARGE` and `INVALID_ORDER` from stored data are `failure`, never an empty list.
6. Return the outcome; presentation renders it and writes the log line.

### 5.11 Authorization server hooks (assistants infrastructure, new)

Better Auth accepts one `hooks.before` middleware. `features/assistants/infrastructure/oauth-hooks.ts` exports it as one dispatcher by `ctx.path`, registered in `auth.ts`; for each path it parses `ctx.query` or `ctx.body` with a Zod schema before reading them (JSON boundary rule) and lets any other path through untouched. Better Auth runs it on every HTTP request **and** on every nested dispatch a plugin makes (`dispatchAuthEndpoint` in 1.7.14 runs the user's before hook with `ctx.path` set to the dispatched endpoint): the consent endpoint dispatches `/oauth2/authorize` after writing the consent, and the sign-in after-hook dispatches it to continue an authorization. The same file exports the **Yoyos consent marker**: an `AsyncLocalStorage<{ oauthClientId; userId }>` that `oauth-grant.ts` sets around its server-side consent call; Better Auth's endpoint dispatch stays in that async chain, so the dispatcher sees the marker in the consent call and in the authorize it nests.

| Path | Hook | Why |
| --- | --- | --- |
| `/oauth2/register` | Refuses (`invalid_redirect_uri`) any `redirect_uris` entry that fails `isAllowedRedirectUri`, and replaces a sent `scope` with `orders:read offline_access`. At `/authorize` the plugin's `validateRedirectUri` option returns `defaultResult && isAllowedRedirectUri(uri)`: registered for the client and allowed. | Custom schemes and non-loopback `http` cannot be verified; the screen's return line would lie (review gate, B2). |
| `/oauth2/authorize` | Reads the authorization parameters (`client_id` for the marker and the stale check, `scope`) from the source the plugin itself uses (rule below), and sets `scope` to `orders:read offline_access` in that same source. When the Yoyos consent marker is set for this (client, user), stops there: it is the authorize nested in the owner's **Permitir acceso**, and the consent was written a moment ago. Otherwise, when a session exists (read with `getSessionFromCtx(ctx)`, which sees `ctx.context.session`: in the continuation after sign-in the new session exists only there, the request carries no session cookie yet, so `auth.api.getSession({ headers })` or a cookie read would miss it and let a stale consent issue a code), reads whether (client, user) has an active connection (`findConnectionForClient`, plus `isConnectionActive`); if not, deletes that client's and user's `oauthConsent` rows before the plugin looks them up. This covers the agent's HTTP `/authorize` and the continuation after sign-in. | Guarantees «no active connection ⇒ the screen is shown» whatever left a consent behind (failed save, failed revocation, an ended connection), while the owner's own allow returns a code on the first tap (review gate r2, B1). Scope normalization keeps agents that ask for `openid` or only `offline_access` from failing or connecting without `orders:read`. |
| `/oauth2/consent` | Refuses the call unless the Yoyos consent marker is set for the client and session user of that call, so neither the browser nor any other server code can accept or deny a consent. Both `acceptRequest` and `rejectRequest` set it. | The only path that issues a code after consent is the Yoyos action, which saves the row. |

Each hook that reads Yoyos data runs the company read inside `withTenantIsolation` from the session's `loadUserAccess`; a session that is not `ready` (an account without a store) leaves the request to the plugin, which sends the owner to the authorization screen, where the account state is shown. An unverified account never has a session (`requireEmailVerification: true`, `autoSignIn: false`); its state is shown at sign-in (section 10).

**Authorize parameter source** (verified in `@better-auth/oauth-provider` 1.7.14, `getAuthorizationRequestParameters`: `ctx.method === "POST" && settings?.isAuthorize === true ? ctx.body : ctx.query`, where the endpoint uses `settings = ctx.authorizeSettings ?? { isAuthorize: true }` and every nested dispatch passes `authorizeSettings` without `isAuthorize: true`: `{}` in the sign-in continuation, `{ postLogin: boolean }` in the authorize nested in the consent call). The dispatcher applies the same expression through one pure function, `authorizeParameterSource(ctx)`, never the method alone and never «`authorizeSettings` is an empty object» (the consent path would then read the body and the first tap would fail); the unit fixtures cover both nested shapes:

| Entry path | `ctx.method` | `ctx.authorizeSettings` | Parameters in |
| --- | --- | --- | --- |
| Top-level HTTP `GET /api/auth/oauth2/authorize` | `GET` | absent | `ctx.query` |
| Top-level HTTP form `POST /api/auth/oauth2/authorize` | `POST` | absent | `ctx.body` |
| Sign-in continuation (the plugin's after hook on `POST /sign-in/email` sets `ctx.query` from the signed query and calls `runOAuth2Authorize`) | `POST` (the sign-in's), body is the sign-in body | `{}` | `ctx.query` |
| Authorize nested in the consent call (`runOAuth2Authorize` spreads the consent context) | `POST` (the consent's), body is `{ accept, oauth_query }` | `{ postLogin: boolean }` | `ctx.query` |

When the parameters do not parse (the source is not an object, `client_id` is missing or not a non-empty string, `scope` is present and not a string), the dispatcher fails closed: it throws `invalid_request` (`400`) and the plugin does not run, so no code is issued and no consent is read. A failure reading the session, the user's access or the connection also fails closed (`server_error`, `503`, logged `assistant_authorize_hook_failed`), never falls through to the plugin with a consent that may be stale.

Dependency direction: `auth.ts` imports `features/assistants/auth-hooks.ts`, which builds the dispatcher and the `onPasswordReset` callback from `oauth-hooks.ts`, the connection lookup and revocation (`systemPrisma` and tenant Prisma) and `loadUserAccess` from `features/users` wired there with `userRepository` and `companyRepository` (never `src/shared/infrastructure/current-user.ts` or `resolveCurrentAccess`, which import `auth.ts`); nothing reachable from it imports `auth.ts`, so the hook is defined when `betterAuth({...})` evaluates. `auth.api` reaches `oauth-grant.ts` only through `features/assistants/composition.ts`, which imports `auth.ts` and is never imported by it. T1 checks there is no import cycle with `pnpm dlx madge --circular` on `apps/core/src`, run without adding `madge` to `package.json`.

Why a marker and not «row first»: saving the row before the consent would leave a listed connection when the consent then fails, against «no connection is created», and would need a compensating delete that can itself fail. The marker keeps the order of section 5.1 and is scoped to one call chain, client and user.

### 5.12 `listCompanyCouriers` (delivery-settings, new)

Input `{ companyId }`; one `companyCourier.findMany` with the courier name, disabled couriers included, no lock and no other settings. Composed as `deliverySettings.listCouriers(companyId)`. `buscar_pedidos` uses it to turn a courier name into `courierId`.

## 6. Domain and typing

| Type | Where | Why it exists |
| --- | --- | --- |
| `AssistantConnectionId` | `assistants/domain/assistant-connection.ts` | Branded UUID; distinct from order and user ids. |
| `OAuthClientId` | same | Branded string; the plugin's `client_id`, not a UUID. |
| `AssistantScope` | `assistants/domain/scopes.ts` | `"orders:read"` today; MCP 2/4–4/4 add literals. A union keeps tool modules and consent in sync. |
| `ReturnTarget` | `assistant-connection.ts` | `{ kind: "web"; domain: string } \| { kind: "this_device" }`. A loopback redirect has no domain to show; a discriminated union avoids a fake domain. |
| `AssistantConnection` | same | `{ id, companyId, authorizedByUserId, oauthClientId, agentName: AgentName \| null, returnTarget, scopes, authorizedAt, lastUsedAt: Date \| null }`. No existing concept holds an agent's grant to a store. |
| `ConnectionWithPasswordChange` | same | The connection plus `passwordChangedAt: Date \| null` of its authorizing account, read together for `isConnectionActive`. |
| `NewAssistantConnection` | same | Creation input without `lastUsedAt`. |
| `AgentName` | same | Branded; `parseAgentName(raw)`: trimmed, control characters removed, 1–80 characters; absent or empty → `null`. |
| `SignedAuthorizationRequest` | `assistants/application/authorize-assistant.ts` | The raw signed query string the plugin passed to the authorization screen; parsed only by `readRequest`. |
| `AssistantAccess`, `AssistantOwnerAccess` | `assistants/application/` | Access objects per guide 2.2. |
| `LimiterDecision` | `src/shared/infrastructure/fixed-window-limiter.ts` | `{ allowed: true } \| { allowed: false; retryAfterSeconds: number }`; the catalog boolean cannot tell the agent how long to wait. |
| `DispatchCandidate` | `orders/application/list-dispatch-queue.ts` | `StockOrder` plus the four fields readiness and ordering need; reuses the stock rule's input instead of a parallel model. |
| `DispatchReadiness`, `DispatchStock` | `orders/domain/dispatch-readiness.ts` | See below. |
| `UnpaidSummary`, `DispatchQueuePage` | orders application | Section 5. |
| `AssistantOrder`, `AssistantOrderSummary` | `assistants/domain/order-projection.ts` | The masked views. They have no field that can hold a full phone, a street, a reference or a document. |

Rules (pure):

```ts
// assistants/domain/assistant-connection.ts
export function isConnectionActive(connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number): boolean;
// coalesce(lastUsedAt, authorizedAt) > now − days  AND  (passwordChangedAt === null || authorizedAt > passwordChangedAt)
export function isAllowedRedirectUri(uri: string): boolean;   // https with a non-loopback host, or http on 127.0.0.1, [::1] or localhost; no userinfo, no fragment
export function returnTargetOf(uri: string): ReturnTarget;   // https → { kind: "web", domain: host }; loopback → { kind: "this_device" }
export function sameMinute(a: Date, b: Date): boolean;

// orders/domain/dispatch-readiness.ts
export type DispatchStock = Readonly<{ stockDue: StockDue | null; shortAtCurrentStock: readonly VariantId[] }>;
export type DispatchReadiness =
  | Readonly<{ kind: "ready"; operation: "ship" | "deliver" }>
  | Readonly<{ kind: "blocked"; operation: "ship" | "deliver"; reason:
      | Readonly<{ code: "SHIP_PAYMENT_REQUIRED" | "PAYMENT_REQUIRED"; pendingReport: boolean }>
      | Readonly<{ code: "STOCK_WAITING"; variantIds: readonly [VariantId, ...VariantId[]] }>
      | Readonly<{ code: "STOCK_DEDUCTING" }> }>
  | Readonly<{ kind: "delivery_unassigned" }>;
export function classifyDispatchCandidate(candidate: DispatchCandidate, stock: VariantStock): Readonly<{ stock: DispatchStock; readiness: DispatchReadiness }>;
export function describeDispatchReadiness(order: DispatchCandidate, stock: DispatchStock): DispatchReadiness | null; // null when cancelled or not pending
```

`describeDispatchReadiness`: no delivery → `delivery_unassigned`; `operation` = `deliver` for store pickup, else `ship`; the fulfillment state (`paymentStatus`, `paidAmount`) is derived from the candidate's total and confirmed payments; `orderFulfillmentBlock(state, operation)` decides first (payment, then stock due); when it allows shipping but the order is not deducted, not due and `shortAtCurrentStock` is not empty → `STOCK_WAITING` with those variants (the product's deliberate difference from the button). `pendingReport` = the order has a `reported` payment, set only on payment reasons. The projection turns variant ids into «Camisa (M · Azul)» from the page's full aggregates. `STOCK_NOT_DEDUCTED` cannot reach the tool for pending store pickups paid in full, because such orders are due and carry `stockDue`; if it appears it is rendered as the web text.

Masking (pure, `assistants/domain/order-projection.ts`):

| Function | Rule |
| --- | --- |
| `maskPhone(phone)` | Last 3 digits of the digits in the phone → `"termina en 789"`; fewer than 3 digits → `null`. |
| `normalizeText(text)` | Unicode NFKC, every Unicode space as a plain space, format and control characters (Cf, Cc: zero-width spaces, bidi marks) removed (decided by the coordinator after T4 review r2 (founder criterion: never a complete phone)). |
| `maskDigitRuns(text)` | After `normalizeText`, any run of digits that, ignoring any characters other than letters and digits between digits (spaces, any dash, underscore, comma, dots, slashes, parentheses, plus sign, emoji), has 6 or more digits becomes «•••» plus its last 3 digits; shorter runs («Tienda 24») are kept (decided by the coordinator after T4 review r2 (founder criterion: never a complete phone)). |
| `isPhoneLikeName(name)` | After `maskDigitRuns`, the name has a masked run and no letters. Such a name is treated as absent (a chat contact saved without a name can carry its number as name). |
| `displayName(name)` | Every name the assistant returns (buyer, recipient) goes through `maskDigitRuns`; `null` when empty or phone-like. |
| `customerLabel(buyer)` | A name that is not phone-like; else `"Cliente que termina en 427"` from the phone, or from the phone-like name when there is no phone; else `"Público general"` (no buyer, or neither name nor phone). |
| `recipientLabel(recipient)` | Same rule for the recipient's name; plus `maskPhone`. |
| `destinationLabel(delivery)` | Home: `"Miraflores, Lima, Lima"` from district, province, department. Agency: courier, agency name and the agency's own address and location. Store pickup: `"Recojo en tienda"` and the pickup point name and address. No delivery: `"Entrega por definir"`. Never `HomeDestination.address` or `instructions`, never a recipient document. |
| `toAssistantOrderSummary`, `toAssistantOrder` | The only functions that read `buyer`, `delivery.recipient` and `delivery.destination`; they call the functions above. |

The destination keeps today's `PeruDeliveryDistrict` fields as they are in the order snapshot; the projection reads only `district`, `province` and `department` and adds no country branch. The order snapshot type is Peru-specific today (`orders/domain/order-state-machine.ts`); decoupling it is outside this design.

Display formats (pure, `assistants/presentation/display.ts`): `formatMoney` reuses the web money format, dates `dd/MM/yyyy` and times `dd/MM/yyyy HH:mm` in `America/Lima`, state words as the web shows them, source labels «Desde el catálogo», «WhatsApp», «Venta manual», return line «Volverá a chatgpt.com» for `web` and «Volverá a una aplicación de este equipo» for `this_device` (assumption: the product names only the domain case).

## 7. Persistence

### 7.1 `AssistantConnection` (new, company-scoped)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` PK | Generated by core. |
| `companyId` | `uuid` not null, default `dbgenerated(NULLIF(current_setting('app.company_id', true), '')::uuid)` in schema and SQL | FK `Company(id)` `ON DELETE CASCADE`. |
| `authorizedByUserId` | `text` not null | FK `user(id)` `ON DELETE CASCADE`. |
| `oauthClientId` | `text` not null | The plugin's `client_id`. No FK: the client table is Better Auth's. |
| `agentName` | `text` null | `CHECK (agentName IS NULL OR char_length(agentName) BETWEEN 1 AND 80)`. |
| `returnKind` | `text` not null | `CHECK (returnKind IN ('web', 'this_device'))`. |
| `returnDomain` | `text` null | `CHECK ((returnKind = 'web') = (returnDomain IS NOT NULL))`, `CHECK (returnDomain IS NULL OR char_length(returnDomain) BETWEEN 1 AND 253)`. |
| `scopes` | `text[]` not null | `CHECK (cardinality(scopes) >= 1)`. |
| `authorizedAt` | `timestamptz(3)` not null | |
| `lastUsedAt` | `timestamptz(3)` null | `null` = «Sin uso todavía». |

- Unique (`companyId`, `oauthClientId`, `authorizedByUserId`); index (`companyId`, `authorizedByUserId`).
- RLS: `ENABLE` and `FORCE ROW LEVEL SECURITY`; policy `assistant_connection_company_isolation` `USING` and `WITH CHECK` `"companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid`, like `order_company_isolation`.
- Rows are parsed by one strict schema, `parseAssistantConnectionRow` in `assistants/infrastructure/connection-rows.ts` (T0), used by every repository of the feature; an invalid row is `INVALID_STORED_DATA`, logged once.
- «Último uso» write: `UPDATE "AssistantConnection" SET "lastUsedAt" = $now WHERE id = $id AND ("lastUsedAt" IS NULL OR date_trunc('minute', "lastUsedAt") < date_trunc('minute', $now))`, kept as the guard against two calls racing past the in-process skip.
- Unlike `PushDevice` (global, keyed by session), this table is company data: the page lists it per store and any account of the store manages it, so it gets `companyId` and RLS.

### 7.2 Better Auth oauth-provider tables (new, global)

`oauthClient`, `oauthResource`, `oauthClientResource`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent` and `oauthClientAssertion`, generated into `schema.prisma` with the Better Auth CLI from the configured plugin and mapped like the existing auth models. Global, no RLS, accessed through `systemPrisma`, like `session` and `jwks`. Tokens are stored hashed (`storeTokens: "hashed"`, plugin default). `core_app` receives DML through the existing default privileges. Required indexes, added to the generated models when the CLI omits them:

| Table | Index | Serves |
| --- | --- | --- |
| `oauthClient` | unique `clientId` | Every authorize, token and register lookup. |
| `oauthClientResource` | unique `(clientId, resourceId)` | The resource check at token time. |
| `oauthRefreshToken` | unique `token`; `(userId, clientId)` | Refresh by hashed token; revocation by client and user; the cascade and any plugin lookup by user alone. |
| `oauthAccessToken` | unique `token`; `(userId, clientId)` | Same, when opaque tokens are stored (T0 verifies whether JWT access tokens are stored at all). |
| `oauthConsent` | `(userId, clientId)` | The plugin's consent lookup, the authorize hook's delete and the cascade on user deletion. |

`userId` leads each pair so one index serves lookups by user alone (a user deletion cascading into these global, growing tables) and by (user, client).

### 7.3 Migrations

Two migrations, generated with `prisma migrate dev --create-only` per the [database-migrations skill](../../.agents/skills/database-migrations/SKILL.md):

1. `add_assistant_connections`: the plugin tables and `AssistantConnection` with constraints, RLS and FKs. Each new table, with its RLS and its FKs to `Company` and `user`, sits in `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = …; … COMMIT;` with both settings as in the precedents `20261001022053` and `20261001004253`, because adding an FK takes `SHARE ROW EXCLUSIVE` on the referenced table.
2. `add_order_dispatch_queue_index`: `RESET lock_timeout; RESET statement_timeout;` then `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_dispatch_queue_idx" ON "Order" ("companyId", "scheduledDispatchDate", number) WHERE NOT cancelled AND "deliveryStatus" = 'pending';`.
   - Alone in its file and without any function body: Prisma runs a migration file in one transaction when it contains one, and `CONCURRENTLY` cannot run inside a transaction. Both timeouts are reset because the build waits for every older transaction; an inherited timeout cancels it and leaves an `INVALID` index.
   - Recovery from a failed build: `DROP INDEX CONCURRENTLY IF EXISTS "Order_dispatch_queue_idx";`, `prisma migrate resolve --rolled-back <migration>`, deploy again.
   - Declared like its precedent `Order_undeducted_pending_idx`: in SQL only, not in `schema.prisma`, because a plain `@@index` without the predicate would make a later `migrate dev` drop and re-create it without `CONCURRENTLY`, locking writes on `Order`. T0 checks that `prisma migrate dev --create-only` with no schema change emits nothing for either partial index; if it emits a drop, T0 stops and reports instead of accepting it.

No data migration: no stores in production and existing stores start with no connections.

### 7.4 Order queries (orders repository, new or modified)

| Function | Query |
| --- | --- |
| `findOrderAggregateByNumber(number, companyId)` | `findOrderAggregate` by `(companyId, number)` (existing unique index); wrapped by `rejectPendingCatalogOrder`. |
| `existsOrder(companyId)` | `SELECT EXISTS (SELECT 1 FROM "Order" WHERE "companyId" = $1 AND NOT ("fromCatalog" AND "checkoutConfirmedAt" IS NULL))`. |
| `findOrderAggregates` | New predicates for `view: "paid"`, `cancelled: "exclude"`, `searchPhone: "exclude"`; the `strpos(b.phone, …)` branch is omitted when excluded. |
| `summarizeUnpaidOrders(companyId)` | One aggregate over the `unpaid` predicate: `count(*)`, `sum(total − confirmed)` grouped by currency, `count(*) FILTER (WHERE EXISTS reported payment)`; catalog exclusion. |
| `findDispatchCandidates(through, limit, companyId)` | `Order_dispatch_queue_idx` range `scheduledDispatchDate <= through`, catalog exclusion, `LIMIT limit`; item lines and confirmed payments as `json_agg` subqueries; `EXISTS` reported payment; parsed with a strict row schema. |
| `findOrderAggregatesByIds` | Existing; used for the 20 orders of the page. |
| `countUndatedPendingOrders(companyId)` | `count(*)` on `Order_dispatch_queue_idx` with `scheduledDispatchDate IS NULL` and the catalog exclusion. |

`findDispatchCandidates` and `countUndatedPendingOrders` repeat the index predicate with the same literals (`NOT o.cancelled AND o."deliveryStatus" = 'pending'`), never as `$queryRaw` parameters: a generic plan of the prepared statement can use a partial index only when the predicate is literal (the lesson already recorded in the repository's `dueAndFit` comment).

`listCompanyCouriers(companyId)` lives in `delivery-settings/infrastructure` (section 5.12).

## 8. Contracts between applications

Mobile is not involved; nothing goes into `shared/contracts`. The external contracts are protocols:

| Contract | Owner | Content |
| --- | --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` (and `/.well-known/oauth-protected-resource`) | `assistants/presentation/oauth-metadata-routes.ts` | RFC 9728: `resource` `${BETTER_AUTH_URL}/mcp`, `authorization_servers` `[BETTER_AUTH_URL]`, `scopes_supported` `["orders:read", "offline_access"]`, `bearer_methods_supported` `["header"]`, `resource_name` «Yoyos». Built with `oauthProviderResourceClient(auth).getActions().getProtectedResourceMetadata`. |
| `GET /.well-known/oauth-authorization-server` | same file | RFC 8414 from `oauthProviderAuthServerMetadata(auth)`: endpoints under `/api/auth/oauth2/*`, `code_challenge_methods_supported` `["S256"]`, `registration_endpoint`, `grant_types_supported` `["authorization_code", "refresh_token"]`. |
| `/api/auth/oauth2/{authorize,token,register,revoke}` | Better Auth plugin | Native behavior plus the dispatcher of section 5.11. `/api/auth/oauth2/consent` answers only under the Yoyos consent marker; every other plugin endpoint is in `disabledPaths` (`404`). |
| `POST /mcp` | `assistants/presentation/mcp-routes.ts` | MCP over `createMcpHandler`; `401` with `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<PRM URL>"` when the token is missing, invalid, expired, of another audience, or its connection is not active; a missing scope is also `401` so the agent re-authorizes; `429` with `Retry-After` past the coarse limit. |
| Tool schemas | `assistants/presentation/tools/orders-tools.ts` | Zod input and output schemas per tool (section 9.3); the JSON Schema the agent sees is generated once at startup. |

## 9. Events and cross-feature integration

No domain event is added or consumed.

### 9.1 Capabilities consumed

| Capability | From | Used by |
| --- | --- | --- |
| `loadUserAccess` | `features/users` composition | `resolveAssistantAccess`, `endAccountAssistantConnections`, the authorize hook |
| `orders.listAggregates`, `orders.hasAny`, `orders.getAggregateByNumber`, `orders.describeDispatchStock`, `orders.summarizeUnpaid`, `orders.listDispatchQueue` | `features/orders/composition.ts` | orders tool module |
| `deliverySettings.listCouriers` | `features/delivery-settings/composition.ts` | courier name → `courierId` in `buscar_pedidos` |
| `auth.api` consent and the plugin helpers | `src/shared/infrastructure/auth.ts` | assistants infrastructure |

The wiring is in `src/composition/assistant-server.ts` (cross-feature, per `docs/architecture.md`); `features/assistants` receives the order capabilities through `deps` and never imports another feature's internals.

### 9.2 Tool modules: the registration point

```ts
// features/assistants/presentation/tool-module.ts
export type ToolModule = Readonly<{
  scope: AssistantScope;                 // a connection without it does not see these tools
  access: "read";                        // the only value this version accepts; a write module needs its own design
  instructions: string;                  // paragraph appended to the server instructions
  tools: readonly RegisteredTool<any, any>[];
}>;
export type RegisteredTool<I, O> = Readonly<{
  name: string;                          // stable ASCII, ^[a-z][a-z0-9_]{2,63}$
  title: string;                         // Spanish display name
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  sampleOutputs: readonly O[];           // for the validator, including a maximum-length case
  run: (input: I, access: AssistantAccess) => Promise<ToolRun<O>>;
}>;
```

`src/composition/assistant-tools.ts` exports `toolModules: readonly ToolModule[]`. At startup the registry builds, for each module, the tool definitions with their JSON Schemas and the annotations derived from `access`: `"read"` → `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. The per-request factory registers only the modules whose `scope` the connection holds. The validator refuses a module whose `access` is not `"read"` and a tool whose annotations differ from those derived from its module, so a later write tool cannot inherit read-only hints. MCP 2/4–4/4 add a module file in `features/assistants/presentation/tools/`, a scope literal in `domain/scopes.ts`, its consent lines in `app/locales.ts`, and one entry in `assistant-tools.ts`; none of them edits the server, the transport, the limiter, the projection rules for orders or another module. A connection that lacks a new scope keeps its current tools until the owner authorizes again (product rule).

### 9.3 The four order tools

| Name | Title | Input (Zod, all optional unless noted) | Calls |
| --- | --- | --- | --- |
| `buscar_pedidos` | Buscar pedidos | `texto` (≤ 120), `pago` (`"por cobrar"` \| `"pagado"`), `entrega` (`"pendiente"` \| `"despachada"` \| `"entregada"`), `incluir_cancelados` (boolean, default false; ignored with `pago`, as the description says), `courier` (≤ 80), `creado_desde`, `creado_hasta`, `despacho_programado_desde`, `despacho_programado_hasta`, `sin_fecha_de_despacho` (boolean), `despachado_desde`, `despachado_hasta` (dates `YYYY-MM-DD`), `pagina` (integer ≥ 1, default 1) | `orders.listAggregates` with `searchPhone: "exclude"` and `cancelled: "exclude"` unless included; courier resolved by accent- and case-insensitive name against `deliverySettings.listCouriers` (exact match first, else a unique partial match; none or several → invalid input listing the store's couriers); an empty first page with filters calls `orders.hasAny` to tell «No hay pedidos con esos filtros.» from «Tu tienda todavía no tiene pedidos.» |
| `ver_pedido` | Ver pedido | `numero` (required; `"1001"` or `"#1001"`) | `orders.getAggregateByNumber`, then `orders.describeDispatchStock` for that order (one snapshot, one stock read) |
| `pedidos_por_cobrar` | Pedidos por cobrar | `pagina` | `orders.summarizeUnpaid` and `orders.listAggregates` (`view: "unpaid"`) |
| `pedidos_por_despachar_hoy` | Pedidos por despachar hoy | `pagina` | `orders.listDispatchQueue` with `today = limaCalendarDay(clock())` |

Every list output carries `hoy` («Hoy es 30/10/2026»), `pagina`, `total` and `hay_mas` («hay más: pide la página 2») when there are more. Each order carries `enlace` = `${BETTER_AUTH_URL}/orders/<id>`. Field names in outputs are Spanish snake case, matching the language of the descriptions. Descriptions and server instructions are the product texts, kept in `features/assistants/presentation/tools/orders-texts.ts`.

### 9.4 Limiters

`src/shared/infrastructure/fixed-window-limiter.ts`: `createFixedWindowLimiter(limit, windowMs, now)` → `(key) => LimiterDecision`. Stale windows are swept at most once per window instead of on every call. `catalog/presentation/rate-limit.ts` keeps its exports and becomes a wrapper (`decision.allowed`), so catalog behavior and tests do not change. Two assistant instances:

| Limiter | Key | Limit | Where |
| --- | --- | --- | --- |
| Request | `${sub}:${azp}` of the verified token | `ASSISTANT_REQUEST_LIMIT` (300) per minute, every `POST /mcp` | `mcp-routes.ts`, before any database read; refused → `429` with `Retry-After`, no «Último uso» update |
| Store | `companyId` | `ASSISTANT_TOOL_CALL_LIMIT` (60) per minute, `tools/call` only | `answerToolCall`, step 1 |

Per process, reset on deploy (accepted by the founder); more than one web instance needs a shared store.

Known behavior: the shared JWKS cache throttles forced reloads for an unknown `kid` to one per 30 seconds, counted from the last load, so after a manual key rotation a token signed with the new key can be refused for up to 30 seconds (the keys only rotate by hand).

## 10. Web (React Router)

| Route | File | Behavior |
| --- | --- | --- |
| `assistants/authorize` and `:locale/assistants/authorize` | `app/routes/assistant-authorize.tsx` | Public layout. `headers` export: `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`, so the screen cannot be framed (clickjacking, RFC 6819 §4.4.1.9). Loader: `resolveCurrentAccess`; no session → redirect to `/login?<same signed query>`; `company_required` → «Primero crea tu tienda…» with **Crear mi tienda** linking to the existing registration company step; it does not offer **Permitir acceso**. (`verification_required` cannot reach this loader: an unverified account has no session; if it ever did, the loader renders the same message as the sign-in below.) `ready` → `readRequest` → screen with the agent name and «(nombre indicado por el asistente)», the return line, store name, «Podrá ver» lines from the scope, «Nunca podrá», «Conectado como <email>» and **Usar otra cuenta**. Invalid and expired requests show their texts. |
| — action | same | `intent=allow` → `authorizeAssistant`; `intent=deny` → `denyAssistant`; `intent=switch_account` → server-side sign-out, then redirect to `/login?<same signed query>` (the signed query lives in the URL and is not bound to the session, so it survives sign-out; T1 verifies this). The page submits with a fetcher: while pending, **Permitir acceso** shows progress and both buttons are disabled; a network error before the request is sent shows «No pudimos enviarlo. Revisa tu conexión y vuelve a tocar Permitir acceso.» with the buttons enabled again; a sent request without an answer (timeout) shows «No sabemos si se conectó…». On success the page shows «Listo. Ya puedes volver a tu asistente.» (or «No diste acceso…») and then sets `window.location` to the returned URL. Repeating with the same request is safe: the upsert keeps one row. |
| `settings/assistants` and `:locale/settings/assistants` | `app/routes/assistant-settings.tsx` | Private layout. Loader: connector address (`${BETTER_AUTH_URL}/mcp`) and `listAssistantConnections`; the list loads in a deferred promise so the address and steps render even when it fails. «Cómo conectarlo» is a disclosure, open when the store has no connection and collapsed when it has one, announcing its state. Revalidates on window focus, so an agent connected from another tab appears without reloading. Action `disconnect` → `disconnectAssistant`; the confirmation dialog names the agent and its connection date; success removes the row, announces «Desconectaste …» politely and moves focus to the next row's **Desconectar** or to the «Asistentes conectados» heading; failure shows «No pudimos desconectarlo…» next to the row, announced, focus back on its **Desconectar**, and the list reloads. |
| Navigation | `app/routes/private-layout.tsx` | New link «Asistentes de IA» after «Catálogo». |
| Login continuation | `app/components/auth-form.tsx`, `src/shared/infrastructure/auth-client.ts` | The auth client adds `oauthProviderClient()`; when the URL carries the signed authorization query, the form shows «Inicia sesión para conectar tu asistente.» and, after sign-in, follows the redirect Better Auth returns instead of `/dashboard`. When sign-in answers `EMAIL_NOT_VERIFIED` and the URL carries the signed query, the form shows, instead of the generic `auth.loginError`, «Verifica tu correo para conectar tu asistente. Después vuelve a tu asistente y conecta de nuevo.» with **Reenviar correo de verificación** (the existing `check-email` screen for that email) and no **Permitir acceso**: this is the product's «Email not verified» state, placed where an unverified account really is (section 17, question 3). When sign-in answers `server_error` and the URL carries the signed query (the dispatcher failed closed in the continuation; the session cookie is set but no code was issued), the form shows «No pudimos continuar con la conexión. Vuelve a tocar Iniciar sesión.» (assumption: the product names no text for this case) instead of `auth.loginError`, which would read as wrong credentials; tapping again continues the authorization. Without the signed query the form keeps today's message. |
| Texts | `app/locales.ts` | `assistants.*` keys in Spanish and Portuguese (consent lines per scope, page, errors). |

Request forgery: the allow, deny and switch actions are React Router actions, protected by React Router's request-origin check and the `SameSite=Lax` session cookie; the plugin's consent endpoint cannot be called from the browser (section 5.11). Both protections are named here so later changes keep them. The pages use existing `app/components/ui` components and the retry and confirmation patterns of `catalog-settings.tsx`.

## 11. Transactions and concurrency

1. **Authorize.** The consent call (Better Auth, its own transaction on `systemPrisma`) runs first; then the upsert of `AssistantConnection` in a tenant transaction (`withTenantIsolation` + `withinTransaction`). Two concurrent taps: the plugin issues two codes; `INSERT … ON CONFLICT DO NOTHING` lets one insert win and the other read the row `FOR UPDATE` as `unchanged`, so both land on one row and neither fails; the agent exchanges only the code it receives. A code for which the upsert failed is never delivered, and its consent is dropped by the authorize hook on the next attempt. The nested authorize inside the consent call runs under the Yoyos consent marker and keeps the consent it just wrote (section 5.11).
2. **Disconnect.** `DELETE … WHERE id AND companyId RETURNING` under RLS, then revocation on `systemPrisma`. Not one transaction (two clients); the row is the authority, revocation is cleanup.
3. **Tool call.** Reads only. The dispatch queue's candidates, stock and 20 aggregates share one short `withinReadSnapshot`. The «Último uso» update is a single conditional `UPDATE` in its own short transaction, never enclosing the tool's reads, so parallel calls of one agent never wait on that row.
4. **Password reset.** The cleanup runs after Better Auth commits the reset; deletes in the user's tenant, then revokes. The call-time rule does not depend on it.
5. **Limiters.** Synchronous `Map` updates in one process; no await between read and increment.
6. **Per-call budget.** One `tools/call` costs: JWT verification in process; `findUser` and `findCompany` (`loadUserAccess`); the connection probe in one tenant transaction; the credential `account.updatedAt` read (`account (userId)` index, `"providerId" = 'credential'`, one probe even if social sign-in adds account rows); the «Último uso» update at most once per minute; two to five tool statements. About 5 to 9 short transactions. `initialize` and `tools/list` pay the four access reads and are bounded by the request limit. MCP 2/4–4/4 must not add per-call lookups to this path; a new one is a design change.

## 12. Code organization

| File | Change |
| --- | --- |
| `apps/core/package.json` | T0: add `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `@better-auth/oauth-provider`; devDependency `@modelcontextprotocol/client`; bump `better-auth`, `@better-auth/expo`, `better-call`, `@better-fetch/fetch`. T3: script `mcp:validate`. |
| `apps/core/prisma/schema.prisma`, `prisma/migrations/<ts>_add_assistant_connections/`, `prisma/migrations/<ts>_add_order_dispatch_queue_index/` | Section 7. |
| `src/shared/infrastructure/auth.ts` | `oauthProvider({ loginPage: "/login", consentPage: "/assistants/authorize", scopes, resources, DCR options, TTLs, validateRedirectUri })`, `disabledPaths`, `rateLimit.customRules` and the client-IP header (T0); `hooks.before` dispatcher registration and `emailAndPassword.onPasswordReset` (T1). |
| `src/shared/infrastructure/auth-client.ts` | `oauthProviderClient()`. |
| `src/shared/infrastructure/jwt-verifier.ts` | Extract the cached JWKS key set with throttled forced refresh, shared by both verifiers (the mobile verifier keeps its checks). |
| `src/shared/infrastructure/fixed-window-limiter.ts` (+ test) | New. |
| `src/features/catalog/presentation/rate-limit.ts` | Delegates to the shared limiter. |
| `shared/orders-date.ts` (+ test) | `limaCalendarDay(now)`. |
| `src/features/orders/domain/dispatch-readiness.ts` (+ test) | `classifyDispatchCandidate`, `describeDispatchReadiness`, `orderDispatchQueue`. |
| `src/features/orders/application/list-order-aggregates.ts` | New criteria values and precedence. |
| `src/features/orders/application/get-order-by-number.ts`, `has-any-order.ts`, `summarize-unpaid-orders.ts`, `list-dispatch-queue.ts` (+ tests) | New use cases. |
| `src/features/orders/infrastructure/order-repository.ts` | Section 7.4. |
| `src/features/orders/composition.ts` | Expose the new operations. |
| `src/features/delivery-settings/application/list-company-couriers.ts`, `infrastructure/…`, `composition.ts` | `deliverySettings.listCouriers`. |
| `src/features/assistants/domain/` | `assistant-connection.ts`, `scopes.ts` (T0); `order-projection.ts` (T4) (+ tests). |
| `src/features/assistants/infrastructure/connection-rows.ts`, `oauth-grant-revocation.ts`, `connection-lookup.ts` | T0: row schema and parser; `revokeClientGrant`; `findConnectionForClient(client, user)` with the password change time. |
| `src/features/assistants/application/` | `authorize-assistant.ts`, `deny-assistant.ts`, `list-assistant-connections.ts`, `disconnect-assistant.ts` (with `endAccountAssistantConnections`) (T1); `resolve-assistant-access.ts`, `answer-tool-call.ts` (T3) (+ tests). |
| `src/features/assistants/infrastructure/` | `connection-repository.ts` (create, list, delete) and `oauth-grant.ts` (read signed request, accept, deny) and `oauth-hooks.ts` (T1); `connection-access-repository.ts` (touch, end) and `assistant-token-verifier.ts` (T3). |
| `src/features/assistants/presentation/` | `oauth-metadata-routes.ts` (T0); `mcp-routes.ts`, `tool-module.ts`, `tool-registry.ts`, `server-instructions.ts` (T3); `display.ts`, `tools/orders-tools.ts`, `tools/orders-texts.ts` (T4). |
| `src/features/assistants/auth-hooks.ts` | T1: builds the hooks dispatcher and the `onPasswordReset` callback for `auth.ts`, importing nothing that imports `auth.ts` (section 5.11). |
| `src/features/assistants/composition.ts` | T1: connection operations for the web routes, the hooks and the password-reset callback. |
| `src/composition/assistant-server.ts` | T3: wires verifier, limiters, access resolution, clock and tool modules into `mcp-routes`; T4 adds the order capabilities. |
| `src/composition/assistant-tools.ts` (+ `assistant-tools.test.ts`, the validator) | T3 (empty list and fixture module); T4 adds the orders module. |
| `src/app.ts` | T0 mounts `/.well-known/oauth-*`; T3 mounts `/mcp`; both after `brandHostEdge`, before the `/api` parsers. |
| `app/routes.ts`, `app/routes/assistant-authorize.tsx`, `app/routes/assistant-settings.tsx`, `app/routes/private-layout.tsx`, `app/components/auth-form.tsx`, `app/locales.ts` | T1, section 10. |
| `.env.example`, `compose*.yaml` | T0: `ASSISTANT_*` variables with their initial values. |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `assistant_tool_called` | info | `tool-registry.ts`, after the answer is built | `["requestId", "companyId", "connectionId", "tool", "outcome", "durationMs"]` (`outcome`: `answered`, `empty`, `rate_limited`, `invalid_input`, `not_found`, `failure`) |
| `assistant_access_refused` | info | `mcp-routes.ts` | `["requestId", "reason", "oauthClientId", "userId", "companyId"]` (`reason`: `missing_token`, `invalid_token`, `request_limit`, `not_ready`, `no_connection`, `inactive`, `password_changed`, `scope`; `oauthClientId` and `userId` once the token verified, `companyId` once resolved) |
| `assistant_authorization_answered` | info | `assistant-authorize.tsx` action, after the answer | `["companyId", "userId", "oauthClientId", "answer"]` (`answer`: `allowed`, `denied`, `invalid`, `expired`) |
| `assistant_connection_created` | info | `authorize-assistant` adapter after commit | `["companyId", "connectionId", "userId", "oauthClientId", "returnKind"]` |
| `assistant_connection_ended` | info | disconnect, password reset, inactive, password changed | `["companyId", "connectionId", "reason"]` |
| `assistant_stale_consent_dropped` | info | `oauth-hooks.ts` | `["userId", "oauthClientId"]` |
| `assistant_authorize_hook_failed` | error | `oauth-hooks.ts`, when a session, access or connection read fails on `/oauth2/authorize` | `["requestId", "userId", "oauthClientId", "errorCode", "err"]` |
| `assistant_consent_refused` | warn | `oauth-hooks.ts`, a consent call without the Yoyos marker | `["requestId", "userId", "oauthClientId"]` |
| `assistant_grant_revocation_failed` | warn | `oauth-grant-revocation.ts` | `["companyId", "connectionId", "err"]` |
| `assistant_connection_touch_failed` | warn | `connection-access-repository.ts` | `["companyId", "connectionId", "err"]` |
| `assistant_password_reset_cleanup_failed` | error | `endAccountAssistantConnections` adapter | `["userId", "errorCode", "err"]` |
| `assistant_authorization_failed` | error | `oauth-grant.ts` on an unexpected plugin failure | `["userId", "oauthClientId", "errorCode", "err"]` |
| `dispatch_queue_too_large` | warn | `list-dispatch-queue` adapter | `["companyId", "candidateCount"]` |
| `assistant_tool_failed` | error | the adapter that hits the failure, once (existing order repository logs stay as they are) | `["companyId", "connectionId", "tool", "errorCode", "err"]` |
| `http_request_completed` | info | existing middleware | unchanged; `route` normalizes to `/mcp` |

`oauthClientId` is the plugin's public client identifier, not a secret. Never logged: tool inputs and outputs, order numbers searched, customer data, the agent's declared name, tokens, codes, signed queries. Order UUIDs appear only inside links returned to the agent, never in logs.

## 14. Tests

### Unit (core)

`assistants/domain/assistant-connection.test.ts`
- `test("treats a connection used 89 days ago as active and one used 90 days ago as ended")`
- `test("counts inactivity from authorization when the connection was never used")`
- `test("ends a connection authorized before the account's last password change")`
- `test("rejects an agent name made only of spaces or longer than 80 characters")`
- `test("accepts https and loopback http redirect URIs and refuses custom schemes, other http hosts, userinfo and fragments")`
- `test("returns the domain for an https redirect and this device for a loopback redirect")`

`assistants/domain/order-projection.test.ts`
- `test("shows only the last three digits of the buyer and recipient phone")`
- `test("labels a nameless buyer by the last three phone digits")`
- `test("treats a buyer name made of a phone number as no name")`
- `test("labels an order without buyer, or a buyer without name and phone, as Público general")`
- `test("reduces a home destination to district, province and department")`
- `test("keeps the agency address and the pickup point address because they are business data")`
- `test("never includes the street, the delivery reference or the identity document in any projected field")`
- `test("shows Entrega por definir when the order has no delivery")`

`orders/domain/dispatch-readiness.test.ts`
- `test("marks a home delivery with a confirmed payment and enough stock as ready to dispatch")`
- `test("blocks a home delivery without confirmed payment with the ship payment reason")`
- `test("adds the pending report flag only to payment reasons")`
- `test("blocks a store pickup with a pending balance with the full payment reason")`
- `test("blocks an order waiting for stock naming only the short items")`
- `test("blocks a partially paid order whose items exceed current stock although shipping is allowed")`
- `test("marks a deducting home delivery as ready and a deducting store pickup as blocked")`
- `test("reports delivery unassigned for a pending order without delivery")`
- `test("returns no readiness for a cancelled order")`
- `test("orders overdue before today, ready before blocked, oldest date then lowest number")`
- `test("paginates overdue and today as one sequence of twenty")`

`orders/application/list-dispatch-queue.test.ts`, `summarize-unpaid-orders.test.ts`, `get-order-by-number.test.ts`, `list-order-aggregates.test.ts`
- `test("counts overdue and today orders and their ready ones on every page")`
- `test("loads full orders only for the page")`
- `test("answers queue too large above the candidate ceiling instead of a partial queue")`
- `test("returns a persistence failure instead of an empty queue when the read fails")`
- `test("answers order not found for an unknown number")`
- `test("paid and unpaid views exclude cancelled orders even when cancelled orders are included")`

`shared/orders-date` test
- `test("returns 30/10 as today at 23:30 Lima on 30/10, which is 04:30 UTC on 31/10")`

`fixed-window-limiter.test.ts`
- `test("allows sixty calls in a window and refuses the sixty-first with the seconds left")`
- `test("starts a new window after a minute")`
- `test("counts each key apart")`

`assistants/infrastructure/oauth-hooks.test.ts`
- `test("reads authorize parameters from the query for a top-level GET")`
- `test("reads authorize parameters from the body for a top-level form POST")`
- `test("reads authorize parameters from the query in the sign-in continuation although it is a POST with a sign-in body")`
- `test("reads authorize parameters from the query in the authorize nested in the consent call although it is a POST with a consent body")`
- `test("refuses an authorize whose parameters do not parse without running the plugin")`
- `test("refuses an authorize when the connection read fails instead of passing a possibly stale consent")`

`assistants/application/*.test.ts`
- `test("accepts the request before saving the connection and returns the agent redirect")`
- `test("saves nothing when the request expired")`
- `test("tells an expired request from a tampered one")`
- `test("keeps one connection when the same request is allowed twice")`
- `test("allowing again an active connection keeps its name, dates and last use")`
- `test("denying a request returns the access denied redirect and saves nothing")`
- `test("disconnecting an already ended connection succeeds")`
- `test("disconnect succeeds when token revocation fails and logs it")`
- `test("a failed password reset cleanup is logged and the connection is still refused on its next call")`
- `test("refuses access when the account is not ready, has no connection or the connection is inactive")`
- `test("ends an inactive connection when its token is used")`
- `test("checks the store limit before updating last use and still updates it on a refused call")`
- `test("skips the last use write when it was already written this minute")`
- `test("updates last use when the input is invalid")`
- `test("maps a reading failure to failure, never to an empty answer")`

`src/composition/assistant-tools.test.ts` (static validator)
- `test("every tool has an ASCII name, a Spanish title and a description")`
- `test("every input schema is a valid strict JSON Schema object")`
- `test("every tool's annotations are the ones derived from its read module")`
- `test("refuses a module that is not declared read")`
- `test("no tool name or title names a write action")`
- `test("every sample output validates against its output schema")`
- `test("no sample output contains the fixture phone, street or document")`
- `test("a twenty-order page with maximum-length texts stays under 24 KB")`
- `test("an order with sixty maximum-length item lines and ten payments stays under 24 KB")`
- `test("a connection without the orders scope lists no order tools")`
- `test("rejects a fixture module that breaks any of these rules")`

`assistants/presentation/tools/orders-tools.test.ts`
- `test("accepts 1001 and #1001 as the same order number")`
- `test("refuses an end date before the start date naming both dates")`
- `test("refuses an unknown courier listing the store's couriers")`
- `test("finds a disabled courier that still has orders")`
- `test("tells a store without orders from a search without matches")`
- `test("ignores incluir_cancelados when a payment filter is given")`
- `test("states today's Lima date in every list")`

`app/components/auth-form.test.tsx`
- `test("shows Verifica tu correo with resend verification and no Permitir acceso when an unverified account signs in from an agent request")`
- `test("keeps the generic sign-in error for an unverified account without an agent request")`
- `test("shows the retry text instead of the credentials error when sign-in from an agent request answers a server error")`

`app/routes/assistant-authorize.test.tsx`, `assistant-settings.test.tsx`
- `test("disables both buttons and shows progress while the answer is pending")`
- `test("shows the not sent message and enables the buttons again when the request fails before sending")`
- `test("shows the in doubt message when the request was sent without an answer")`
- `test("offers create store without Permitir acceso to an account without a store")`
- `test("lists a newly connected agent when the page regains focus without reloading")`
- `test("forbids framing the authorization screen")`
- `test("collapses Cómo conectarlo once the store has a connection")`
- `test("moves focus to the next Desconectar or the heading after a disconnect and announces it")`
- `test("the disconnect dialog names the agent and its connection date")`

### Integration (core, real database)

`assistants/infrastructure/connection-repository.integration.test.ts`
- `test("upserting the same client and account twice keeps one row")`
- `test("deleting another store's connection id answers no row and changes nothing")` (checks the use case's success-without-effect contract, beyond the shared RLS mechanism)
- `test("last use is written at most once per minute")`

`orders/infrastructure/order-repository.integration.test.ts` (additions)
- `test("finds an order by number only in its company")`
- `test("does not find an unconfirmed catalog order by number")`
- `test("search without phone does not match the buyer phone")`
- `test("summarizes count, owed amount and pending reports over every unpaid order")`
- `test("dispatch candidates exclude cancelled, delivered, future and unconfirmed catalog orders")`
- `test("knows whether a store has any confirmed order")`

`delivery-settings` integration
- `test("lists a store's couriers, disabled included, without locking the settings row")`

`assistants/infrastructure/oauth-flow.integration.test.ts` (T1)
- `test("a registered public client completes authorization code with PKCE and gets a token for the MCP resource")`
- `test("registration refuses a custom scheme redirect URI")`
- `test("a stored consent without an active connection still shows the authorization screen")` (owner already signed in)
- `test("a stored consent without an active connection still shows the authorization screen after signing in from the agent request")` (starts signed out; the continuation path)
- `test("denying a request returns the access denied redirect through the consent endpoint under the marker")`
- `test("a consent call without the Yoyos marker is refused")`
- `test("two concurrent first allows keep one connection and both answer the agent redirect")`
- `test("a request that expires between reading and accepting answers expired")`
- `test("a form POST authorization drops a stale consent, shows the authorization screen and is normalized to orders and offline access")` (top-level `POST`, parameters in the body)
- `test("a GET authorization drops a stale consent and shows the authorization screen")` (top-level `GET`, parameters in the query)
- `test("allowing a first-time request returns the agent redirect with a code on the first tap")` (real plugin, real dispatcher, through `acceptRequest`'s exact `auth.api.oauth2Consent` call with the built `request` and `asResponse: false`, not an HTTP shortcut; review gate r2 B1 and r3 B1)
- `test("authorize refuses an https redirect URI not registered for the client, also when a consent and an active connection exist")` (review gate r2, B2)
- `test("registration with openid profile email scopes succeeds and the connection holds orders and offline access")`
- `test("the unused plugin endpoints such as create-client answer 404")`
- `test("an unverified account signing in from an authorization request gets the email-not-verified answer and no code")`
- `test("reusing a rotated refresh token within ten seconds keeps the grant")`
- `test("an authorization asking for openid or only offline_access is normalized to orders and offline access")`
- `test("the consent endpoint refuses a direct browser call")`
- `test("switching account keeps the signed request")`
- `test("refresh keeps working after the owner signs out")`
- `test("refresh fails after disconnect")`
- `test("the registration rate limit refuses the sixth registration in a minute from one client IP")`

`assistants/presentation/mcp-routes.integration.test.ts` (T3, fixture tools and rows written directly)
- `test("answers 401 with the protected resource metadata URL when no token is sent")`
- `test("refuses a mobile JWT, a token for another audience and a token of another type")`
- `test("refuses an MCP token on /api")`
- `test("ignores the session cookie on /mcp")`
- `test("answers 401 when the connection row is gone or unused for 90 days")`
- `test("a call with an ended connection creates or updates no connection row")`
- `test("refuses the 61st call of a store while another store keeps answering")`
- `test("answers 429 past the request limit without reading the database")`
- `test("serves the authorization server and protected resource metadata")`

`assistants/presentation/assistant-lifecycle.integration.test.ts` (T4, real flow)
- `test("lists the four order tools for a connected store")`
- `test("never returns another store's order for the same number")`
- `test("a disconnected connection gets 401 on its next call")`
- `test("a password reset ends the connections that account authorized and not the others")`

### E2E (web, happy path)

`tests/e2e/assistants.spec.ts`
- `test("an owner signs in from an agent request, allows access and sees the agent listed in Asistentes de IA")`
- `test("an owner disconnects an agent from Asistentes de IA")`

### Manual checks

- Connect Claude (custom connector) and ChatGPT (custom connector or developer mode) to the deployed server, allow access, ask the four questions, disconnect, ask again.
- MCP Inspector against the deployed server: OAuth flow, `tools/list`, each tool.
- Authorization screen and «Asistentes de IA» on a phone browser: touch targets, focus, announcements.

## 15. Limits and checks during implementation

- T0: check that Better Auth's rate limiter is active in production for the plugin paths and keyed by the real client IP behind Coolify (an integration test sends six registrations with one forwarded IP, then six with a client-supplied `x-forwarded-for` chain behind the configured `trustedProxies`); record the header shape Coolify's proxy sends and the result in the PR.
- T0: confirm the indexes of section 7.2 exist after generation and whether JWT access tokens are stored at all.
- T0: run the existing mobile JWT, cookie and password-reset suites after the Better Auth set bump, before any other change; run `pnpm --dir apps/mobile test` and sign in and refresh from the mobile app (client `better-auth`/`@better-auth/expo` 1.7.5) against the bumped server, and record that client 1.7.5 with server 1.7.14 works.
- T0: read the plugin's endpoint list after install and confirm every path outside register, authorize, token, revoke and consent is in `disabledPaths` and answers `404`.
- T1: verify that the dispatcher can rewrite `scope` on `/oauth2/authorize` (a returned `context.query` replaces the request's) and that the Yoyos consent marker is visible in the authorize nested by the consent endpoint and absent in the agent's HTTP `/authorize` and in the continuation after sign-in; if the plugin reads the query before the hook applies, the hook rejects the request with `invalid_scope` instead and the agent's exact scope request is recorded in the PR.
- T1: record the exact registration body (`scope`, `redirect_uris`, `grant_types`) and the `scope` and `resource` at `/authorize` that Claude, ChatGPT and MCP Inspector send; a client that omits `resource` would receive an opaque token, which `/mcp` refuses (T3 test), and the PR says so.
- T1: verify that the credential `account.updatedAt` changes on password reset and on nothing else Yoyos does to that row.
- T1: verify the signed authorization query is not bound to the session, so **Usar otra cuenta** keeps it.
- T2: measure on a store with exactly the ceiling of dispatch candidates (4 990 stale overdue plus 10 dated today, all pending), 2 000 undated pending orders and 50 000 orders in total: `listDispatchQueue` page 1 and page 2 as use-case wall time (SQL, stock read, strict parse, classification and sort) with the share spent in Node; `summarizeUnpaid`; `listAggregates` with `view: "unpaid"` and `"paid"`, the newest-first list, a text search by buyer name and the courier filter. Target under 300 ms each. Fallbacks, each in its own `CONCURRENTLY` migration and reported: for the unpaid predicates `Payment ("companyId", "orderId") INCLUDE (amount) WHERE status = 'confirmed'`; for the sort `Order ("companyId", "createdAt" DESC, id)`; for the name search the `pg_trgm` precedent of migration `20261010115424`; for the courier filter an expression index on `(delivery -> 'courier' ->> 'id')`. For the dispatch queue the lever is lowering `ASSISTANT_DISPATCH_QUEUE_MAX`; T2 records the value that met the target.
- T2: `EXPLAIN` `findDispatchCandidates` and `countUndatedPendingOrders` under `SET plan_cache_mode = force_generic_plan` and show they use `Order_dispatch_queue_idx`.
- T2: locate the web combination text helper used by the order detail and reuse it for «Camisa (M · Azul)».
- T3: confirm that `GET` and `DELETE` on `/mcp` answer `405` through `createMcpHandler` with no streams offered, and whether the Inspector's browser mode needs CORS (the founder guide uses the proxy mode, which does not).
- T3: confirm that `brandHostEdge` leaves `/mcp` and `/.well-known/*` untouched on the app host and does not serve them on catalog subdomains.
- Out of this design: cleanup of never-used dynamic clients and expired plugin token rows (section 17), a shared limiter for several instances, a mobile page.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0 (blocker: dependencies, plugin config, schema, migrations, shared connection pieces, metadata)   ║   T2 (orders and courier reads)
Wave 2:  T1 (hooks, authorization screen, Asistentes de IA, lifecycle)   ║   T3 (MCP endpoint, verifier, access, limiters, registry, validator)   — both after T0
Wave 3:  T4 (projection, order tools, texts, lifecycle integration) — after T1, T2 and T3
Final:   founder guide run against the deployed branch
```

File ownership between tasks that run at the same time:

| File or area | T0 | T2 | T1 | T3 |
| --- | --- | --- | --- | --- |
| `package.json` | ✓ (dependencies) | | | ✓ (`mcp:validate` script line; wave 2) |
| `schema.prisma`, migrations, `.env.example`, compose | ✓ | | | |
| `auth.ts` | ✓ (plugin, rate limits) | | ✓ (hooks, reset callback; wave 2) | |
| `assistants/domain/assistant-connection.ts`, `scopes.ts`, `infrastructure/connection-rows.ts`, `oauth-grant-revocation.ts`, `connection-lookup.ts`, `presentation/oauth-metadata-routes.ts` | ✓ | | | |
| `src/app.ts` | ✓ (metadata) | | | ✓ (`/mcp`; wave 2) |
| orders feature, `shared/orders-date.ts`, delivery-settings couriers read | | ✓ | | |
| assistants authorize/deny/list/disconnect, `connection-repository.ts`, `oauth-grant.ts`, `oauth-hooks.ts`, `features/assistants/auth-hooks.ts`, `assistants/composition.ts`, `auth-client.ts`, web routes, `auth-form.tsx`, `private-layout.tsx`, `app/locales.ts` | | | ✓ | |
| `jwt-verifier.ts`, `fixed-window-limiter.ts`, `catalog/presentation/rate-limit.ts`, access and tool-call use cases, `connection-access-repository.ts`, `assistant-token-verifier.ts`, `mcp-routes.ts`, `tool-module.ts`, `tool-registry.ts`, `server-instructions.ts`, `src/composition/assistant-server.ts`, `assistant-tools.ts` | | | | ✓ |

T0 and T2 share no file; T1 and T3 share no file (`auth.ts`, `src/app.ts` and `package.json` are touched in wave 2 by one task each). The product draft's B3 edit is part of this design round, not of any task. T4 runs alone and edits `src/composition/assistant-server.ts` and `assistant-tools.ts` after T3.

### T0. Dependencies, OAuth provider configuration, schema, shared connection pieces and metadata

**Scope:** add the dependencies and bump the Better Auth set; configure `oauthProvider` in `auth.ts` (pages, scopes, resource, DCR, TTLs, `refreshTokenReuseInterval`, `validateRedirectUri` returning `defaultResult && isAllowedRedirectUri(uri)`), `disabledPaths` and `rateLimit.customRules` with the client-IP header; both migrations and the plugin models with the indexes of section 7.2; `assistants/domain/scopes.ts` and `assistant-connection.ts` (types, `isConnectionActive`, `isAllowedRedirectUri`, `returnTargetOf`, `sameMinute`); `connection-rows.ts`, `oauth-grant-revocation.ts`, `connection-lookup.ts`; `oauth-metadata-routes.ts` and their mount in `app.ts`; environment variables.
**Out of scope:** hooks, authorization screen, login change, MCP endpoint, tools, password-reset callback.
**Acceptance criteria:**
1. With `better-auth`, `@better-auth/expo` at 1.7.14, `better-call` 1.4.4 and `@better-fetch/fetch` 1.3.3, the existing core unit, integration and E2E suites and `pnpm --dir apps/mobile test` stay green, and the mobile app (client 1.7.5) signs in and refreshes its JWT against the bumped server.
2. `GET /.well-known/oauth-authorization-server` returns the registration, authorize and token endpoints under `/api/auth/oauth2/` and `S256`; `GET /.well-known/oauth-protected-resource/mcp` returns resource `${BETTER_AUTH_URL}/mcp`.
3. `POST /api/auth/oauth2/register` with `{ "client_name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"], "token_endpoint_auth_method": "none" }` answers `201` with a `client_id`; six registrations in one minute from one forwarded IP, with the rate limiter enabled as in production: the sixth answers `429`; a client that adds its own `x-forwarded-for` values still lands in its real IP's bucket.
4. `\d` on the plugin tables shows the indexes of section 7.2; `Order_dispatch_queue_idx` exists and is valid.
5. `revokeClientGrant` for (client, user) leaves their refresh and access tokens revoked and their consent deleted, rewrites no already-revoked row and touches no other client's rows.
6. `POST /api/auth/oauth2/create-client` with a signed-in session answers `404`; an authorization with a `redirect_uri` that passes `isAllowedRedirectUri` but is not registered for the client answers `invalid_redirect`.
7. A no-change `prisma migrate dev --create-only` emits nothing for `Order_dispatch_queue_idx` or `Order_undeducted_pending_idx`.
**Tests:** domain tests of `assistant-connection.ts`; metadata and registration integration tests; `revokeClientGrant` integration test.
**Depends on:** nothing.

### T1. Authorization hooks, authorization screen, «Asistentes de IA» and connection lifecycle

**Scope:** `oauth-hooks.ts`, `auth-hooks.ts` and their registration in `auth.ts` (no import cycle); `authorizeAssistant`, `denyAssistant`, `listAssistantConnections`, `disconnectAssistant`, `endAccountAssistantConnections`; `connection-repository.ts`, `oauth-grant.ts`; `features/assistants/composition.ts`; `onPasswordReset` in `auth.ts`; `auth-client.ts`; routes `assistant-authorize.tsx`, `assistant-settings.tsx`, navigation, login continuation in `auth-form.tsx`, `app/locales.ts`; `oauth-flow.integration.test.ts`; E2E `assistants.spec.ts`.
**Out of scope:** `/mcp`, token verification at call time, tools.
**Acceptance criteria:**
1. Rosa, not signed in, opens an authorization URL of a registered client: she sees the sign-in with «Inicia sesión para conectar tu asistente.», signs in and lands on «Claude quiere leer los pedidos de Tienda Rosa» with «Volverá a claude.ai»; the response carries `frame-ancestors 'none'`.
2. The first tap of **Permitir acceso**, through the real plugin and dispatcher, redirects to the client's redirect URI with a `code`, and «Asistentes conectados» shows «Claude», «Conectado el 30/10/2026», «Sin uso todavía». A double submit leaves one row.
3. **No permitir** redirects with `error=access_denied` and creates no row.
4. An altered signed query shows «Este enlace de conexión no es válido…»; one older than 10 minutes shows «Esta solicitud venció…» and creates no row.
5. After a stored consent is left without a row (save failure simulated, or row deleted directly), the next authorization of that client shows the screen again, both when the owner is already signed in and when the owner signs in from the agent's request.
6. A registration with `redirect_uris: ["evil://chatgpt.com/cb"]` is refused; one with `http://localhost:6274/oauth/callback` is accepted and the screen says «Volverá a una aplicación de este equipo».
7. An unverified account signing in from an authorization request sees «Verifica tu correo para conectar tu asistente…» on the sign-in with **Reenviar correo de verificación** and no **Permitir acceso**; an account without a store sees its authorization screen with **Crear mi tienda** and without **Permitir acceso**; **Usar otra cuenta** signs out and returns to the sign-in with the same request.
8. **Desconectar** removes the row and revokes the client's refresh token; disconnecting from a second tab also succeeds.
9. Resetting Rosa's password deletes her connections and keeps Luis's connection of the same store; with the cleanup failing (simulated), the error is logged and her connection is no longer listed.
**Tests:** section 14 titles for authorize, deny, disconnect, password reset, connection repository, OAuth flow, web routes and E2E.
**Depends on:** T0.

### T2. Orders and courier read capabilities for the assistant

**Scope:** `limaCalendarDay`; `classifyDispatchCandidate`, `describeDispatchReadiness`, `orderDispatchQueue`; `getOrderAggregateByNumber`, `hasAnyOrder`, `summarizeUnpaidOrders`, `listDispatchQueue`, `describeDispatchStock`; the new `AggregateCriteria` values and precedence; repository functions in section 7.4; new operations in `orders/composition.ts`; `deliverySettings.listCouriers`; the measurements of section 15.
**Out of scope:** any MCP, assistants or web file; changes to existing web or mobile behavior; the index migration (T0).
**Acceptance criteria:**
1. On 30/10/2026 with the product's acceptance criterion 11 data, `listDispatchQueue` page 1 returns #1048 (overdue, ready), then #1050 ready, #1051, #1052, #1053, #1054 blocked with the expected reasons, not #1049, and `undatedPending` 1.
2. With 3 overdue and 25 today, page 1 holds 3 overdue and 17 today, page 2 the other 8, both with the same summary; each page loads 20 full aggregates at most.
3. A home delivery with S/ 30.00 of S/ 80.00 confirmed, 4 «Camisa · M» ordered and 3 in stock is `STOCK_WAITING` naming «Camisa · M».
4. `summarizeUnpaid` with #1060 (S/ 100.00 unpaid) and #1061 (S/ 80.00, S/ 30.00 confirmed, one report) returns count 2, owed S/ 150.00, `withPendingReport` 1; unconfirmed catalog #1070 is excluded everywhere and `getAggregateByNumber(1070)` answers `ORDER_NOT_FOUND`.
5. `listAggregates` with `search: "987654789", searchPhone: "exclude"` does not find #1001; without `searchPhone` it still does (web unchanged).
6. With the T0 index present (or created in the test database), the measurements of section 15 are under 300 ms or the PR names the extra index added.
**Tests:** section 14 titles for readiness, dispatch queue, unpaid summary, order by number, has-any, list precedence, Lima day, couriers and the order repository additions.
**Depends on:** nothing (runs with T0; the measurement uses T0's index once merged).

### T3. MCP endpoint, token verifier, assistant access, limiters, tool registry and validator

**Scope:** shared JWKS cache in `jwt-verifier.ts` with throttled refresh; `fixed-window-limiter.ts` and the catalog wrapper; `assistant-token-verifier.ts`, `connection-access-repository.ts`, `resolveAssistantAccess`, `answerToolCall`; `tool-module.ts`, `tool-registry.ts` (definitions built once, annotations from `access`), `server-instructions.ts` (generic part), `mcp-routes.ts` with `createMcpHandler` and `toNodeHandler`; `src/composition/assistant-server.ts`, `src/composition/assistant-tools.ts` (empty module list), the validator test with a fixture module; `/mcp` mount in `app.ts`; `mcp:validate` script; `mcp-routes.integration.test.ts`.
**Out of scope:** order tools and their texts, consent, web pages, the lifecycle flows that need T1.
**Acceptance criteria:**
1. `POST /mcp` without a token answers `401` with `WWW-Authenticate` naming `/.well-known/oauth-protected-resource/mcp`.
2. A mobile JWT, an expired token, a token with another `aud` and a token whose `typ` is not `at+jwt` answer `401`; an MCP token on `GET /api/me` answers `401`.
3. A token whose connection row was deleted answers `401`; one whose connection was last used 90 days ago answers `401` and the row is gone; one authorized before the account's last password change answers `401`.
4. With a fixture tool, the 61st call of Tienda Rosa within a minute returns `isError` with `retryAfterSeconds`, Tienda Luis's call in that minute answers, and the log has one `assistant_tool_called` line per call with `outcome`; 301 requests of one (account, client) in a minute: the 301st answers `429` and issues no database query.
5. One hundred requests with random `kid`s within 30 seconds cause at most one JWKS reload.
6. `pnpm --dir apps/core mcp:validate` passes and fails when the fixture module breaks a rule.
**Tests:** section 14 titles for limiter, access resolution, tool call pipeline, validator and `mcp-routes`.
**Depends on:** T0.

### T4. Projection, order tools, agent texts and lifecycle integration

**Scope:** `order-projection.ts`, `display.ts`, `tools/orders-tools.ts`, `tools/orders-texts.ts` (descriptions, server instructions paragraph, messages), the orders entry in `assistant-tools.ts`, the order capabilities in `assistant-server.ts`, the tool tests, `assistant-lifecycle.integration.test.ts`.
**Out of scope:** new order queries (T2), transport and access (T3), consent and page (T1).
**Acceptance criteria:**
1. The product acceptance criteria 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 20 and 21 hold through `tools/call` on a test server with real data and a connection made through the real authorization flow.
2. No response of any tool in the integration suite contains «987654789», «Av. Larco 123» or «45678912».
3. `tools/list` returns exactly `buscar_pedidos`, `ver_pedido`, `pedidos_por_cobrar`, `pedidos_por_despachar_hoy`, all read-only, and `mcp:validate` passes with them, including the 24 KB budget.
**Tests:** section 14 titles for projection, order tools, validator and the lifecycle integration cases.
**Depends on:** T1, T2, T3.

### Final verification

The founder runs the guide below against the deployed branch (Claude and ChatGPT cannot reach `localhost`; use the Coolify preview or a tunnel). Results, screenshots of the authorization screen and the page, the `mcp:validate` and Inspector outputs, the rate-limit check of T0 and the measurements of T2 go in the pull request description.

### Founder guide (goes into the pull request)

**Connect your agent**

1. Open Yoyos web → Ajustes → **Asistentes de IA** and tap **Copiar** next to «Dirección del conector» (`https://app.yoyos.lat/mcp` in production).
2. Claude (web or desktop): Settings → Connectors → **Add custom connector**; name «Yoyos», paste the address, **Add**, then **Connect**. ChatGPT: Settings → Apps & Connectors → **Create** (it may ask to enable developer mode in Advanced settings); paste the address, authentication OAuth, **Create**. Your plan must allow custom connectors.
3. A Yoyos window opens: sign in if asked, check that it says «Volverá a claude.ai» (or «chatgpt.com») and tap **Permitir acceso**. You see «Listo. Ya puedes volver a tu asistente.».
4. Back in Yoyos → Asistentes de IA, the agent appears as connected.

**Try it** (expected answer in brackets)

- «¿Qué pedidos tengo que despachar hoy?» (overdue first, then today; blocked ones with the Yoyos reason).
- «¿Quién me debe?» (count and total owed, then the orders).
- «¿Cómo va el pedido 1001?» (full order; phone only as «termina en …», district only).
- «Busca los pedidos de Carla de la semana pasada» (search by name and dates).
- «Cancela el pedido 1001» (the agent says it cannot and gives the Yoyos link).
- In Asistentes de IA, check «Último uso» changed; tap **Desconectar**, then ask again (the agent asks you to reconnect, and the Yoyos screen appears again).

**Check the server without an agent (MCP Inspector)**

1. Run `npx @modelcontextprotocol/inspector` and open the URL it prints.
2. Transport «Streamable HTTP», URL `https://app.yoyos.lat/mcp`, connection type «Via Proxy»; open **Auth Settings** → **Quick OAuth Flow**, sign in and allow (the screen says «Volverá a una aplicación de este equipo»).
3. **Connect** → **Tools** → **List Tools**: exactly the four tools, all marked read only. Run each with an empty input or a real order number.

## 17. Questions decided by the review gate

For the founder to confirm in the pull request.

1. When the same OAuth client is authorized again by the same account while its connection is active, how many rows does «Asistentes conectados» show?
   - Answer: (1) one row per (store, client, account). While the row is active, re-authorizing the same client skips the screen and changes nothing (the plugin issues a code from the stored consent; «Conectado el» and «Último uso» keep their values). The product line «Connecting the same agent again creates a new connection; both appear» holds per client registration: ChatGPT and Claude register a new client each time the connector is added, so adding it twice shows two rows; reconnecting the same registration does not.
   - Decided by: both gate reviewers (architecture and performance), on condition that the screen guarantee of blocker B1 holds (section 5.11).
   - Reason: the plugin binds consent and tokens to (client, user); a second row for the same pair could not be told apart at token time (`azp` + `sub`), would linger unused for 90 days, and the per-call lookup stays a single unique-index probe.
   - Discarded: (2) a row per authorization, which needs a per-authorization reference in the tokens (the plugin's `consentReferenceId` is not stable between consent and token issuance), more custom code around the plugin and rows the agent no longer uses.

2. Who may register an OAuth client?
   - Answer: (1) anyone, through open dynamic client registration, with the conditions both reviewers attached: redirect URIs limited to https and loopback, with the return line shown accordingly (B2); the registration rate limit configured on purpose and verified to apply with the real client IP behind the proxy (T0 acceptance criterion 3); and the cleanup of never-used clients and expired token rows tracked as a task (the founder decides on its Todoist task; it is listed below as a deferred item with real risk).
   - Decided by: both gate reviewers.
   - Reason: it is what ChatGPT, Claude and other MCP clients use; the owner's sign-in and consent protect the data, and the screen shows the verified return domain next to the declared name.
   - Discarded: (2) a redirect-URI allowlist, which contradicts «any agent that accepts a remote MCP connector» and needs a release per agent; (3) Client ID Metadata Documents alone, which lock out agents that only do registration. Recorded as a later option: `@better-auth/cimd` 1.7.14 can run alongside registration and give verified identity to the clients that support it.

3. Where does an owner with an unverified email see «Verifica tu correo para conectar tu asistente…»?
   - Answer: at the sign-in step of the authorization flow. When sign-in answers that the email is not verified and the URL carries the signed authorization query, the sign-in shows that same message with **Reenviar correo de verificación** and no **Permitir acceso** (section 10). The product draft's «Email not verified» state, its edge case and acceptance criterion 3 were edited to say so; nothing else in the product draft changed.
   - Decided by: the coordinator, on review gate r2's blocker B3.
   - Reason: unverified accounts have no session by design (`requireEmailVerification: true`, `autoSignIn: false`), so the authorization screen can never show them; the sign-in is where the owner is, and the message keeps the product intent.
   - Discarded: a session for unverified accounts (weakens verification for every sign-in); the generic sign-in error (does not tell the owner what to do).

Question 1 holds with review gate r2's conditions met: the first allow returns a code (B1, Yoyos consent marker) and allowing an active connection again, when an agent forces the screen with `prompt=consent`, keeps the row as it is. Question 2 holds with r2's conditions met: `/authorize` requires a registered **and** allowed redirect URI (B2), and the session-authenticated client endpoints are disabled, so registration is the single, rate-limited entry.

## 18. Review suggestions kept or changed

Every finding of round 1 was accepted; none was kept as it was. Round 2: every blocker and suggestion of both reports was accepted except the architecture reviewer's S7, kept: past the dispatch ceiling the tool keeps the product's reading-failure text («Inténtalo de nuevo en unos segundos»), which invites a retry the ceiling will not grant; no store is near 5 000 pending dated orders, and a distinct text is a product change, so it is listed below as a deferred item. Round 5: approved by the architecture reviewer with two suggestions, both accepted: the consent-nested authorize receives `{ postLogin }`, not `{}` (fixtures cover both shapes), and the login form shows a retry text, not the credentials error, when the continuation fails closed.

Round 4: the architecture blocker (the hook must take the authorize parameters from the plugin's own source: the body only for a top-level HTTP `POST`, the query for every nested dispatch) and both suggestions (safe `loadUserAccess` wiring and `pnpm dlx madge`; status and this record) were accepted; nothing else changed.

Round 3: the architecture blocker (the server-side consent call needs a `Request`) and every suggestion of both reports were accepted; none was kept. The performance reviewer's r2 finding 8 was accepted as a validator case for `ver_pedido` without capping its lines (an order beyond the budget still answers). Where a fix changes behavior the product did not define, it is marked as an assumption or listed under «Decided unless objected»:

- The return line for a loopback redirect, «Volverá a una aplicación de este equipo», is a new text (B2); the product names only the domain case.
- The coarse request limit (300 per minute per account and client, before any database read) refuses with `429` without updating «Último uso»; the product rule «limit refusals update «Último uso»» stays true for the 60-per-minute store limit it describes.
- The dispatch queue's safety ceiling answers with the product's reading-failure text past 5 000 candidates; no new text.

Decided unless objected:

- MCP library `@modelcontextprotocol/server` v2 through `createMcpHandler` and `toNodeHandler`, serving 2026-07-28 natively and 2025-era clients through the stateless fallback; no streams; `@modelcontextprotocol/client` as a devDependency.
- Authorization server is Better Auth's `@better-auth/oauth-provider` with one `hooks.before` dispatcher around it (registration: redirect URIs and scope; authorize: scope normalization and stale-consent drop, skipped under the Yoyos consent marker; consent: only under that marker), `validateRedirectUri` returning registered **and** allowed, and every unused plugin endpoint in `disabledPaths` (reworded after the r2 objection, B1, B2 and S1); the Better Auth set moves to 1.7.14 together, checked against the mobile client 1.7.5.
- A rotated refresh token is reusable for 10 seconds (`refreshTokenReuseInterval`), initial value.
- Allowing again an active connection (agent sent `prompt=consent`) keeps its name, dates and «Último uso».
- The 24 KB budget is measured on the JSON; the text copy repeats it. `ver_pedido` lists every line.
- The dispatch-queue partial index is declared in SQL only, like `Order_undeducted_pending_idx`.
- Scope always normalized to `orders:read offline_access`; no OpenID scopes; resource `${BETTER_AUTH_URL}/mcp`; JWT access tokens signed with the existing JWKS, verified with pinned `alg`, `typ`, `iss`, `aud` and a strict claim schema, without a live-session check.
- Access token 1 hour, refresh token 90 days with rotation, authorization request 10 minutes counted from the last redirect to the screen (sign-in time does not count); all adjustable by environment.
- OAuth endpoint rate limits per client IP: register 5, authorize 30, token 300 per minute, with `trustedProxies` set for the deployment's proxy hops.
- Ended connections are deleted and their grants revoked; nothing keeps a history of connections.
- 90-day inactivity and password changes are checked when a token is used or the list is read; no scheduled job; `onPasswordReset` is the prompt cleanup and logs its failure.
- The MCP bearer resolves through `loadUserAccess` and `withTenantIsolation`; the token carries no company.
- `AssistantConnection` is company data with RLS and the `companyId` default from the tenant setting, unique per store, client and account.
- «Último uso» is skipped in process within the same minute and otherwise written by one conditional update in its own transaction.
- The limiter is extracted to `src/shared/infrastructure/fixed-window-limiter.ts` with seconds left and a once-per-window sweep; catalog keeps its behavior; the store limit is checked before the «Último uso» write.
- Readiness is a pure orders function on top of `orderFulfillmentBlock`, using the web's Spanish `orderFulfillment` texts; the dispatch queue classifies light rows on a new partial index and loads 20 full orders per page.
- Order search for agents excludes the phone through a new criteria flag; paid and unpaid views always exclude cancelled orders; web and mobile search is unchanged.
- Names returned to the assistant mask long digit runs and a name left without letters is treated as no name; the assistant search never matches names by digits (decided by the coordinator after T4 review r2 (founder criterion: never a complete phone)).
- Declared deviation: `ver_pedido` reads two snapshots (section 9.3 says one), as the comment in `assistant-order-capabilities.ts` explains.
- Tool identifiers `buscar_pedidos`, `ver_pedido`, `pedidos_por_cobrar`, `pedidos_por_despachar_hoy`; output fields in Spanish snake case; each output carries `structuredContent` and the same compact JSON as text, within 24 KB.
- Business refusals are tool results with `isError`; only authorization failures are HTTP `401` (a missing scope too), and the coarse limit is `429`.
- Tools are grouped in scope-bound, read-declared modules registered in `src/composition/assistant-tools.ts`; MCP 2/4–4/4 add a module, a scope and consent lines.
- The static validator is a Vitest suite over the in-process server (`mcp:validate`); MCP Inspector is the live check in the founder guide.
- The authorization screen forbids framing; its actions rely on React Router's origin check and `SameSite=Lax`.
- A missing agent name shows the return line alone (assumption).
- New feature `features/assistants`; cross-feature wiring in `src/composition/assistant-server.ts`.

Deferred items with real risk (the founder decides whether to create Todoist tasks):

- Cleanup of never-used dynamic clients and expired plugin token rows: with open registration and hourly refresh rotation, the global `oauthClient` and token tables grow without bound (about 2 000 refresh rows per connection in 90 days). Both gate reviewers made tracking it a condition of question 2.
- Limiter shared across instances: with more than one web instance every limit multiplies by the number of instances.
- A distinct text for a dispatch queue past its ceiling (permanent condition), instead of the retry text.
- The token endpoint limit (300 per minute per IP) covers about 18 000 connections refreshing hourly from one shared agent egress IP; revisit as stores grow.

## 19. Review gate history

| Round | Architecture (design) | Performance |
| --- | --- | --- |
| 1 | Rejected: 4 blockers (stale consent skips the screen, unverifiable redirect domains, password-reset cleanup as the only guarantee, overlapping task files), 15 suggestions | Rejected: 1 blocker (unbounded dispatch-queue read without an index), 11 suggestions |
| 2 | Rejected: 3 blockers (authorize hook deletes the fresh consent in the nested authorize, `validateRedirectUri` replacing registration matching, unreachable unverified-email state), 10 suggestions | Approved, 8 suggestions |
| 3 | Rejected: 1 blocker (server-side consent call without a `Request`), 8 suggestions | Approved, 3 suggestions |
| 4 | Rejected: 1 blocker (authorize parameter source chosen by HTTP method), 2 suggestions | — |
| 5 | Approved, 2 suggestions (applied) | — |

Every blocker was fixed and every suggestion accepted except round 2 S7, kept with its reason (section 18). Questions 1 and 2 were decided by both reviewers; question 3 by the coordinator.
