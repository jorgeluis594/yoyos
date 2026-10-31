# AI assistants

A store owner connects their own AI agent (ChatGPT, Claude, or any agent that accepts a remote MCP connector) to their Yoyos store once, and then asks it in plain language about their orders: find an order, see one order in full, what is still unpaid and what has to be dispatched today. The agent can only read, sees only the store that authorized it, and never receives a customer's full phone, street address or identity document. The interface calls the agent «asistente» and the owner manages connections on the web page «Asistentes de IA».

Core serves one remote MCP endpoint, `${BETTER_AUTH_URL}/mcp` (`https://app.yoyos.lat/mcp` in production), and acts as the OAuth authorization server for it. Each tool call resolves its token to the same user access and tenant context that cookies and mobile JWTs produce, checks that the store's connection is still active, applies the per-store limit, reads through the orders feature and returns a masked projection.

Code: `apps/core/src/features/assistants/` (connections, access resolution, OAuth hooks, projection, MCP routes and tools), cross-feature wiring in `apps/core/src/composition/assistant-server.ts` and `assistant-tools.ts`, Better Auth configuration in `apps/core/src/shared/infrastructure/auth.ts`, shared JWKS cache in `src/shared/infrastructure/jwks-cache.ts`, fixed-window limiter in `src/shared/infrastructure/fixed-window-limiter.ts`, readiness and dispatch queue in `apps/core/src/features/orders/domain/dispatch-readiness.ts`, web routes `apps/core/app/routes/assistant-authorize.tsx` and `assistant-settings.tsx`, texts under `assistants` in `apps/core/app/locales.ts`. Persistence: `AssistantConnection` and the Better Auth `oauth*` models in `apps/core/prisma/schema.prisma`. Initial values of every limit and lifetime: the `ASSISTANT_*` variables in `apps/core/.env.example`.

## Scope

- One connector address for every store; the store comes from who authorizes, never from the address. Reason: the address can be shared without exposing anything.
- Four read-only order tools: **Buscar pedidos**, **Ver pedido**, **Pedidos por cobrar** and **Pedidos por despachar hoy**. There is no tool that creates, changes, cancels, registers, approves, rejects or voids anything. Reason: writes need their own confirmation design.
- Every connection reads all four tools; there is no per-tool choice or partial access to orders.
- The «Asistentes de IA» page is web only. Reason: connecting is done once, where the agent's connector settings live, and it is not a daily operation; cutting an agent from a phone works through the same page in the phone's browser (rejected: a mobile screen and its tests for a one-time task; no page, which would leave a password reset as the only way to cut access).
- An account belongs to one store, so there is no store picker.
- Not supported: customers, products, finances or stock tools; revealing a full phone, address or document to the agent even if the owner asks; CSV export or a daily summary; a history of what an agent asked or received; a limit that survives a restart.

## Connecting

1. The owner opens Yoyos web → Ajustes → «Asistentes de IA» and taps **Copiar** next to the connector address.
2. In their agent's connector settings they add a custom connector, paste the address and save. The agent discovers the Yoyos authorization server, registers itself and opens a Yoyos window in the browser.
3. If the owner is not signed in to Yoyos in that browser, the Yoyos sign-in shows «Inicia sesión para conectar tu asistente.»; after signing in it returns straight to the authorization screen with the same request. «Crear cuenta» keeps working; a new account goes through email verification and store creation, and the owner then starts the connection again from the agent.
4. The authorization screen shows which agent asks, for which store, what it will be able to read and what it will never do. The owner taps **Permitir acceso**.
5. Yoyos shows «Listo. Ya puedes volver a tu asistente.» and sends the browser back to the agent. The connection appears in «Asistentes de IA».

Alternative paths:

- **No permitir**: «No diste acceso. Ya puedes volver a tu asistente.», the agent receives `access_denied` and nothing is created.
- **Usar otra cuenta** signs out and shows the sign-in, which returns to the authorization screen with the same request.
- An account with an unverified email cannot sign in (verification is required and sign-up does not sign in), so the sign-in of a connection shows «Verifica tu correo para conectar tu asistente. Después vuelve a tu asistente y conecta de nuevo.» with **Reenviar correo de verificación** (the existing check-email screen). Reason: the sign-in is where an unverified owner really is (rejected: a session for unverified accounts, which weakens verification for every sign-in; the generic sign-in error, which does not say what to do).
- An account without a store sees «Primero crea tu tienda en Yoyos. Después vuelve a tu asistente y conecta de nuevo.» with **Crear mi tienda**. Neither case offers **Permitir acceso**.
- When the sign-in succeeds but the authorization cannot continue, the sign-in shows «No pudimos continuar con la conexión. Vuelve a tocar Iniciar sesión.» instead of the credentials error; tapping again continues.
- Closing the window midway creates nothing; the owner starts again from the agent.

## Screens

Both web screens follow the interface language (Spanish and Portuguese); the texts here are the Spanish ones. Tool descriptions, server instructions and tool messages are in Spanish for every store.

### Authorization screen

Route `assistants/authorize` (public layout, also under `:locale`), often opened on a phone.

- Title «ChatGPT quiere leer los pedidos de Tienda Rosa», followed by «(nombre indicado por el asistente)», and under it the return line as body text of the same size and weight as the lists: «Volverá a chatgpt.com», or «Volverá a una aplicación de este equipo» for a loopback redirect. Reason: a hostile site can call itself «ChatGPT»; the return domain is the only part Yoyos verifies. An agent that declares no name gets «Un asistente quiere leer los pedidos de Tienda Rosa».
- «Podrá ver»: «Tus pedidos: productos, montos, pagos, entrega y fechas», «El nombre de tus clientes y de quien recibe el pedido», «Los últimos 3 dígitos del teléfono y el distrito de entrega de tus clientes».
- «Nunca podrá»: «Crear, cambiar ni cancelar nada», «Ver teléfonos completos, direcciones ni documentos de tus clientes».
- Footer: «Puedes desconectarlo cuando quieras en Ajustes → Asistentes de IA.» and «Conectado como rosa@ejemplo.com · **Usar otra cuenta**». Main action **Permitir acceso**, secondary **No permitir**.
- **Permitir acceso** shows progress and disables both buttons until the answer arrives. After either answer the screen shows its text while it sends the browser back, so the owner never lands on a blank page if the agent cannot be opened from the browser.
- Invalid or altered request: «Este enlace de conexión no es válido. Vuelve a tu asistente y conecta de nuevo.» Expired request: «Esta solicitud venció. Vuelve a tu asistente y conecta de nuevo.» A request that cannot be read: «No pudimos cargar la solicitud. Vuelve a tu asistente y conecta de nuevo.»
- The screen cannot be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`). Reason: clickjacking of the consent.
- Accessibility: the title is the page heading and reads as one sentence with the return line; each list has its own heading and is a real list, not distinguished by color alone; **Usar otra cuenta**, **Permitir acceso** and **No permitir** have at least the touch target of the navigation links and a visible focus ring.

### «Asistentes de IA»

Route `settings/assistants` (private layout, also under `:locale`), in the Settings navigation after «Catálogo».

- Intro: «Conecta ChatGPT, Claude u otro asistente para preguntarle por tus pedidos. Solo puede leer: no crea, cambia ni cancela nada.»
- «Dirección del conector»: the address shown complete (it wraps, never truncated) and **Copiar**. After copying, «Dirección copiada.», announced politely; if the browser blocks the clipboard, «No pudimos copiarla. Selecciona la dirección y cópiala.». «MCP» never appears in the interface. Reason: owners know «asistente»; vendors ask only for the address.
- «Cómo conectarlo»: three steps that do not name each vendor's menus, which change without notice, plus «Tu plan del asistente debe permitir conectores personalizados.». It is open while the store has no connection and collapsed under a disclosure that announces its state once there is one, so the page becomes the address and the list.
- «Asistentes conectados», newest authorization first: agent name («Asistente» when it declared none), return domain («Una aplicación de este equipo» for loopback), «Conectado el 30/10/2026», «Último uso: hoy, 10:42», «Último uso: 28/10/2026, 10:42» or «Sin uso todavía», and **Desconectar**. Dates and times in America/Lima. Under the list and under the empty state: «Los asistentes se desconectan solos tras 90 días sin uso o si cambias tu contraseña.», so an owner whose agent stopped working knows where its row went.
- The list loads apart from the address and steps, which render even when it fails, and reloads when the tab regains focus, so an agent connected from another tab appears without reloading. States: a placeholder while loading; «Todavía no conectaste ningún asistente.»; «No pudimos cargar la lista de asistentes.» with **Reintentar**. All connections are listed.
- **Desconectar** asks «¿Desconectar ChatGPT, conectado el 30/10/2026?» with «Dejará de ver tus pedidos hasta que lo conectes de nuevo.», **Desconectar asistente** and **Mantener conectado**. The date tells apart two rows of the same agent. Success removes the row, announces «Desconectaste ChatGPT, conectado el 30/10/2026.» and moves focus to the next row's **Desconectar** or to the «Asistentes conectados» heading. Failure shows «No pudimos desconectarlo. Inténtalo de nuevo.» next to the row, announced, with focus back on its **Desconectar**, and the list reloads; the row stays only if the connection is still active.
- Errors use the «No pudimos…» voice and the retry and confirmation components of Settings → Catálogo. The page follows the authorization screen's accessibility rules, because it is the emergency path from a phone.

## Tools

Each tool has a stable ASCII identifier, a Spanish display title and a Spanish description written for the agent: when to use it, when to use another, the exact values each input accepts and how to read the result.

| Identifier | Title | Answers |
| --- | --- | --- |
| `buscar_pedidos` | Buscar pedidos | General search by customer, number, state or dates |
| `ver_pedido` | Ver pedido | Everything about one order named by number |
| `pedidos_por_cobrar` | Pedidos por cobrar | «¿Quién me debe?», «¿cuánto me falta cobrar?» |
| `pedidos_por_despachar_hoy` | Pedidos por despachar hoy | «¿Qué despacho hoy?», «¿qué preparo?» |

The server instructions, shown to the agent once, say: Yoyos is the store's sales tool and this connector only reads; answer in Spanish using only what the tools return; amounts, dates and states come ready to show; wait the seconds the limit gives and never retry in a loop; to change an order, send the owner to Yoyos with the order link; customer phones and addresses are hidden on purpose and the agent must not claim it can get them; on a not-authorized refusal, ask the owner to reconnect from the agent's settings (the address is in Yoyos → Ajustes → Asistentes de IA); there are no sales totals or finances, so say so instead of adding pages of orders; quote a readiness reason instead of turning it into a promise, and «Tiene un pago por revisar.» means reviewing that report in Yoyos, not registering a payment; compute relative ranges from the «Hoy es …» line, not from the agent's clock.

### Common rules

| Aspect | Behavior |
| --- | --- |
| Store | Always the authorized store. No tool accepts a store. |
| Order identity | The visible number; «1001» and «#1001» are the same. Reason: it is what owner and customer say in the chat. |
| Customer | The buyer's name. A buyer without a usable name: «Cliente que termina en 427». No buyer, or neither name nor phone: «Público general». Phone only as «termina en 789». Never an identity document. |
| Destination | Home delivery: district, province and department only («Miraflores, Lima, Lima»). Agency: courier, agency and the agency's own address, which is business data. Store pickup: «Recojo en tienda» and the pickup point with its address. No delivery: «Entrega por definir». |
| Amounts | In the order's currency, as the web formats them: «S/ 120.00». |
| Date inputs | `AAAA-MM-DD`, whole inclusive days in America/Lima; any other format is refused with the remedy. |
| Dates shown | «30/10/2026», times «30/10/2026 10:42», in America/Lima. «Hoy» is today in Lima whatever the agent's zone; every list states «Hoy es 30/10/2026». |
| States | The web's words: «Pagado» or «Pago pendiente» with what is owed; «Pendiente», «Enviada», «Entregada»; «Cancelado», «Completado»; «Pago por revisar» while a buyer report awaits review. The checkout confirmation label is not returned. |
| Source | «Desde el catálogo», «WhatsApp», or «Venta manual» for an order the seller created (the web shows no label for it, and the agent needs a word). |
| Unconfirmed catalog orders | Do not exist for any tool, as in every Yoyos screen ([Public catalog · Rules](public-catalog.md#rules)); **Ver pedido** answers them like a nonexistent number. Reason: the agent must not see what the owner cannot. |
| Link | Each order carries its Yoyos web link, `${BETTER_AUTH_URL}/orders/<id>`. |
| Lists | Newest created first unless the tool says otherwise, 20 per page, with the total and «hay más: pide la página 2». |
| Output | Field names in Spanish snake case. Product names are shortened to 100 characters, combinations to 50 and rejection reasons to 100, so a large order stays within the response budget. |

### Buscar pedidos

- Optional inputs: `texto` (up to 120 characters), `pago` («por cobrar» or «pagado»), `entrega` («pendiente», «enviada» or «entregada»), `incluir_cancelados` (false by default), `courier`, created from and to, scheduled dispatch from and to or `sin_fecha_de_despacho`, dispatched from and to, `pagina`.
- `texto` never searches by phone. A query containing any digit (any Unicode numeric character, after NFKC) searches the order number only; a query without digits searches the customer name. Reason: digits must never match names, so a masked phone cannot be rebuilt by probing. The description tells the agent that a nameless buyer, or one with a number in their name, is found only by order number or by the other filters. Web and mobile search are unchanged ([Orders · Other operations](orders.md#other-operations)).
- «Por cobrar» and «pagado» never include cancelled orders, so `incluir_cancelados` is ignored with `pago`, and the description says so.
- `courier` matches accent- and case-insensitively against every courier the store has, disabled ones included: an exact name first, else a single partial match. No match answers «Tu tienda no tiene el courier "Olba". Couriers: Olva Courier, Shalom.»; several answer «El courier "Ol" coincide con varios: … Indica el nombre completo.».
- Each order: number, created date, customer, source, total, received, payment state with what is owed, delivery state with modality and courier, scheduled dispatch date, link. No readiness and no destination district; the description says both are only in **Ver pedido** and **Pedidos por despachar hoy**.
- Empty: «No hay pedidos con esos filtros.»; a store with no orders at all: «Tu tienda todavía no tiene pedidos.».

### Ver pedido

- Input: `numero` (required).
- Returns dates (created, scheduled dispatch, dispatched, delivered), source, customer, every item line (product, combination, quantity, unit price, subtotal, the mentioned price when it differs), items total, delivery charge, total, received, balance, overpayment, payments (state, amount and method when confirmed, date, masked rejection reason; a receipt is mentioned as «con comprobante» and never sent), delivery (modality, recipient, masked phone, destination, courier or pickup point), order state, «Esperando stock» or «Descontando stock» when it applies, readiness while delivery is pending and the order is not cancelled, link. Every item line is listed, with no cap.
- An unknown number and another store's number answer the same: «No hay un pedido #1234 en tu tienda.». Reason: another store's order numbers must not be learnable.

### Pedidos por cobrar

- Orders not cancelled whose confirmed payments do not cover the total, the same rule as the «Por cobrar» view. Input: `pagina`.
- A summary over every unpaid order, not only the page: «12 pedidos, S/ 1,480.00 por cobrar» and «3 tienen un pago por revisar». A reported payment does not reduce the balance until the owner confirms it. Reason: answers «¿cuánto me deben?» directly instead of leaving the agent to add pages (rejected: a list only).
- Each order: number, created date, customer, total, received, balance, «Pago por revisar», link. Empty: «No tienes pedidos por cobrar.».

### Pedidos por despachar hoy

- Orders not cancelled, delivery «Pendiente», scheduled for today or earlier in Lima. Input: `pagina`. It differs from the «Por entregar» view, which also includes «Enviada» orders, because what the owner prepares in the morning is what has not left yet.
- Summary («Atrasados: 2, 1 listo. Para hoy: 6, 4 listos.»), then «Atrasados» (scheduled before today, with their date) and «Para hoy». Within each group, ready orders first, then blocked; within each part, oldest scheduled date, then lowest number. The 20 per page follow that single sequence, so overdue orders are never pushed off page 1. Summary and the line «Además hay 5 pedidos pendientes sin fecha de despacho.» repeat on every page. Reason: nothing scheduled is forgotten, undated orders are mentioned without flooding stores that do not schedule, and blocked orders are never presented as ready (rejected: only today, which hides overdue orders; every pending order).
- Each order: number, customer, modality, courier or pickup point, destination district, payment state and balance, readiness, link. Empty: «No tienes pedidos para despachar hoy.» plus the undated line when there are any.
- The read classifies light candidate rows and loads full orders only for the page. Above `ASSISTANT_DISPATCH_QUEUE_MAX` candidates the tool answers the reading-failure text instead of a partial queue.

### Dispatch readiness

Readiness follows the rules of the web's «Marcar enviado» and «Marcar entregado» buttons ([Orders · Fulfillment buttons](orders.md#fulfillment-buttons)), payment first, then stock, with the same sentences (`orderFulfillment` in `app/locales.ts`), so the tool and the button never drift.

| Order | Readiness |
| --- | --- |
| Home or agency, at least one confirmed payment, enough stock (deducted, deducting, or available for every item) | «Listo para enviar» |
| Home or agency, no confirmed payment | «Se requiere al menos un pago para enviar.» |
| Store pickup, paid in full, stock deducted | «Listo para entregar» |
| Store pickup, balance pending | «Se requiere el pago completo antes de entregar. Por cobrar: S/ 40.00.» |
| Home or agency waiting for stock, or partially paid with an item's current stock below its quantity | «Para enviar falta stock de Camisa (M · Azul).», naming only the short items |
| Store pickup waiting for stock | «Para entregar falta stock de Camisa (M · Azul).» |
| Store pickup, stock being deducted | «El stock se está descontando; podrás entregarlo en menos de un minuto.» |
| No delivery assigned | «Entrega por definir: falta asignar la entrega.» |

- A payment reason adds «Tiene un pago por revisar.» when the buyer has a report awaiting review, so the owner reviews it instead of registering a duplicate payment.
- A partially paid order with short stock is not «Esperando stock» in Yoyos and its button stays enabled until the tap fails; the tool marks it with the stock sentence anyway. Reason: the owner must not prepare an order Yoyos will refuse to ship.
- A cancelled order shows only «Cancelado», with no readiness.
- Readiness is computed per order at the moment of the call and reserves no stock among the listed orders: two orders each needing 3 of a variant with 4 in stock both show ready, and only the first shipped succeeds. The description tells the agent to warn about this when ready orders share a product.

## Rules

| Aspect | Behavior |
| --- | --- |
| Read only | A tool call records only its connection's «Último uso» and its log line. Every tool module declares `access: "read"` and its tools carry the read-only annotations; the validator refuses anything else. |
| Store isolation | A connection reads only the store that authorized it; another store's order number answers as nonexistent. |
| Consent scope | A connection reads only what its consent listed. A later category of data (products, finances, stock) is not granted silently to an existing connection: the owner authorizes again with that category in «Podrá ver», under a «Nuevo permiso» heading, unless that category's own decision says otherwise. Reason: the owner consented to what the screen listed. |
| Who can authorize | Any signed-in, verified account with a store. There are no roles; the connection belongs to the store and records which account authorized it. Any account of the store can disconnect any of its connections. |
| Masking | In every response of every tool: phone only as its last 3 digits, no street, no reference, no identity document. Names are shown with long digit runs masked (see [Masking](#masking)). The owner cannot turn masking off. Reason: data in a third-party agent's history cannot be recalled. |
| Store limit | 60 tool calls per minute per store, shared by all its connections, in fixed one-minute windows. Discovering tools and connecting do not count. A refused call changes nothing else. Other stores are not affected. Reason: one agent in a loop must not degrade Yoyos for every other store. |
| Limit and restart | Counters live in process memory and start from zero on each deploy. Reason: one web instance; restarts are rare. With more than one instance every limit multiplies by the number of instances. |
| Days | «Hoy» and every date filter are whole inclusive days in America/Lima: «del 2026-10-01 al 2026-10-07» includes the 7th until 23:59 Lima. Reason: same rule as every order filter. |
| Connection life | Active until the owner disconnects it, until 90 days without any tool call (counted from authorization when never used), or until the account that authorized it resets its password; connections authorized by other accounts of the store are unaffected. The agent renews its access by itself while the connection is active. Reason: a forgotten or compromised agent account must not read indefinitely. |
| «Último uso» | Updated by every tool call that reaches the store, including calls refused by the store limit or by invalid input. A call refused as not authorized, or by the coarse request limit, updates nothing. |
| Signing out | Signing out of Yoyos web or mobile does not disconnect agents; disconnecting is done in «Asistentes de IA». |
| Reconnecting | One connection per store, agent registration and authorizing account. ChatGPT and Claude register a new client each time the connector is added, so adding it twice shows two rows, each with its date. Authorizing the same registration again while its connection is active skips the screen and changes nothing (name, dates and «Último uso» stay); when the agent forces the screen, allowing again also keeps the row as it is. Reason: consent and tokens are bound to client and account, so a second row for the same pair could not be told apart at call time. |
| Agent name | What the agent declares (trimmed, control characters removed, at most 80 characters); a notice, not verified. It is always shown with the return domain. |

## When something fails

| Situation | What the user sees |
| --- | --- |
| **Permitir acceso** twice (double tap, back and repeat) | One connection; the second tap shows the same text and returns the same way |
| **Permitir acceso** not sent | «No pudimos enviarlo. Revisa tu conexión y vuelve a tocar Permitir acceso.», buttons enabled again |
| **Permitir acceso** sent without an answer | «No sabemos si se conectó. Revisa tu asistente; si no aparece conectado, conecta de nuevo desde ahí.»; repeating the same request never creates two connections |
| Request expired (10 minutes) or altered | Their texts on the authorization screen; no connection is created |
| **Desconectar** on a connection already ended in another tab | Same as success |
| Store limit exceeded | «Llegaste al límite de 60 consultas por minuto de tu tienda. No reintentes antes de 23 segundos.», with the seconds also as a number |
| Connection ended, token expired or missing | The protocol's not-authorized answer, which lets the agent start authorization again; what the agent shows is its own |
| Invalid input | The field and the remedy, for example «La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).» |
| Reading failed | «No pudimos leer tus pedidos en este momento. Inténtalo de nuevo en unos segundos.», never an empty list |

A read has no doubtful outcome with effect: repeating a call is always safe.

## Masking

The projection in `features/assistants/domain/order-projection.ts` is the only code that reads an order's buyer, recipient and destination, and its output types have no field that can hold a full phone, a street, a reference or a document. Tool output schemas are strict; an output that fails its schema is never sent and the call answers the reading-failure text.

- **Phone**: «termina en 789», the last 3 digits; fewer than 3 digits shows nothing.
- **Normalization** before masking: NFKC (fullwidth digits become ASCII), every Unicode space as a plain space, and removal of default-ignorable code points (such as the invisible Hangul filler U+3164 and variation selectors), format, control, private-use and unassigned characters, and combining marks that follow a numeric character (keycaps, accents on digits). Marks on letters stay, so «José» and scripts with vowel signs survive.
- **Digit runs**: a digit is any Unicode numeric character (`\p{N}`: decimal, circled, dingbat, superscript, subscript, roman). Any characters other than letters and digits may sit between the digits of one run (spaces, any dash, underscores, commas, dots, slashes, brackets, plus signs, emoji). A run of 6 or more digits becomes «•••» plus its last 3 digits, taken by code point; shorter runs («Tienda 24») stay. Reason: never a complete phone in a name, however it is written. A unit test walks every code point to check that no separator lets a nine-digit number be read in order.
- **Accepted limit**: letters break a run, so numerals written as letters (Han numerals, characters NFKC folds into letters) and spelled-out numbers stay as written.
- **Names**: every buyer and recipient name goes through the digit-run rule. A name left without letters after masking is treated as no name (a chat contact saved with its number), so the customer label falls back to «Cliente que termina en …» or «Público general».
- **Payment rejection reasons** go through the same rule, so amounts and dates with 6 or more digits are masked too. Reason: a reason may carry a buyer's number, and losing an amount in a short reason is the safer failure.
- Agency and pickup point addresses are shown: they are business data, not customer data.

## Architecture

### Protocol and transport

- `/mcp` is mounted on the core Express app outside `/api`, before React Router, with its own 100 kB JSON body limit, and never reads cookies. Reason: `/api` treats any `Authorization` header as a mobile JWT; the MCP bearer must never pass through that chain.
- The server uses `@modelcontextprotocol/server` 2.x through `createMcpHandler`, stateless: a fresh server per request with only the tools of the scopes the connection holds. It serves the current protocol revision natively and 2025-era revisions through the SDK's stateless fallback; a 2025-era client that accepts event streams receives each answer as a single SSE message. No sessions, no subscriptions, no server-initiated streams: `GET` and `DELETE` on `/mcp` answer `405`. Reason: every call is an independent read and nothing is lost on deploy. `@modelcontextprotocol/express` is not used: its bearer middleware does not know Yoyos connections.
- `/mcp` and `/.well-known/*` are served only on the app host; brand hosts answer `404` ([Public catalog · Brand host](public-catalog.md#brand-host)).
- HTTP answers: `401` with `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="…"` for a missing, invalid, expired or other-audience token, a connection that is not active, or a missing scope (so the agent re-authorizes); `429` with `Retry-After` past the coarse request limit; `503` when access cannot be read; `413` above 100 kB.
- Each tool returns `structuredContent` and one text block with the same compact JSON. The JSON stays under 24 KB for a twenty-order page and for an order of 60 lines and 10 payments at maximum lengths; a larger order still answers. Business refusals (not found, invalid input, store limit, reading failure) are tool results with `isError: true`, a Spanish message and no `structuredContent` (clients on the v1 SDK validate it against the output schema even on errors); a store-limit refusal carries `retryAfterSeconds` in `_meta`. Only authorization failures are HTTP errors.

### Authorization server

- Better Auth's `@better-auth/oauth-provider` plugin: RFC 8414 metadata, RFC 7591 dynamic client registration, authorization code with PKCE (`S256`), refresh-token rotation, RFC 8707 resource indicators and revocation. Metadata: `/.well-known/oauth-protected-resource/mcp` (RFC 9728, also without the suffix) and `/.well-known/oauth-authorization-server`. The OpenID discovery and the introspection endpoint are not served or advertised. Reason: Yoyos is an OAuth server here, not an OpenID provider.
- Open dynamic registration of public clients. Redirect URIs must be `https` with a non-loopback host or `http` on `127.0.0.1`, `[::1]` or `localhost`, without userinfo or fragment, both at registration and at `/authorize`, where the URI must also be registered for that client. Reason: it is what ChatGPT, Claude and other MCP clients use; sign-in and consent protect the data, and only those URIs have a return target the screen can state truthfully (rejected: a redirect allowlist, which contradicts «any agent» and needs a release per agent; Client ID Metadata Documents alone, which lock out agents that only register).
- Every plugin endpoint other than `register`, `authorize`, `token`, `revoke` and `consent` is disabled (`404`). Reason: the client-management endpoints would let any signed-in user create clients outside the registration rules and its limit.
- The consent endpoint answers only inside the server-side call made by the owner's **Permitir acceso** or **No permitir** (an in-process marker scoped to that call, client and account); neither the browser nor other code can accept or deny a consent. Reason: the only path that issues a code after consent is the one that saves the connection.
- Scope: a sent scope at registration and every requested scope at `/authorize` are replaced by `orders:read offline_access`. Reason: the consent screen lists what this version reads, `offline_access` keeps the refresh token alive when the owner signs out, and agents that ask for `openid` or nothing still connect.
- One protected resource, `${BETTER_AUTH_URL}/mcp`. Access tokens are JWTs (`typ` `at+jwt`, `EdDSA`) with that audience, signed with the existing `jwt` plugin keys.
- Lifetimes (initial values, adjustable by environment): access token 1 hour; refresh token 90 days with rotation; a just-rotated refresh token reusable for 10 seconds, because the plugin otherwise treats any reuse as replay and revokes the grant of an agent that refreshed concurrently or retried; authorization request 10 minutes from the last redirect to the sign-in or the screen, so sign-in time does not count. Token lifetime never decides whether a connection is active; the connection row does.
- OAuth endpoint rate limits per client IP and minute, in memory: register 5, authorize 30, token 300 (agents refresh from shared egress IPs). The client IP is the first `x-forwarded-for` address that is not one of `ASSISTANT_TRUSTED_PROXIES`.
- **Screen guarantee**: without an active connection for the client and account, the authorization screen is shown. Before the plugin looks up a stored consent on `/authorize` (the agent's request and the continuation after sign-in), Yoyos deletes that client's and account's consent when no active connection exists, except in the authorize nested in the owner's own allow. Unparseable parameters fail with `400` and a failure reading session, access or connection fails with `503`, never falling through to a possibly stale consent. Reason: a failed save, a failed revocation or an ended connection must never let an agent skip the screen.
- On **Permitir acceso** the consent is accepted first and the connection saved second; the code reaches the agent only through the redirect returned after the save. Reason: an expired or rejected request never leaves a row, and an issued code whose save failed is never delivered (its consent is dropped on the next attempt). Concurrent first taps land on one row.
- Request forgery: the allow, deny and switch actions are React Router actions protected by the request-origin check and the `SameSite=Lax` session cookie.

### Access per call

1. Verify the JWT: `alg` `EdDSA`, `typ` `at+jwt`, `iss` `BETTER_AUTH_URL`, `aud` the MCP resource, strict claims, lifetime at most the access-token TTL. The token's session is not checked, because a connection outlives sign-out by design. A mobile JWT (`aud` `yoyos-core-api`) is refused here and an MCP token is refused on `/api`.
2. Coarse limit: 300 `POST /mcp` per minute per account and client, before any database read.
3. Resolve the user through `loadUserAccess`, the same loader as cookies and mobile JWTs; anything but a verified user with a store is not authorized. The token carries no company: the company comes from the user, and the rest of the request runs inside `withTenantIsolation` ([RLS with Prisma](rls-with-prisma.md)).
4. Find the connection by client and account and check it is active: `coalesce(lastUsedAt, authorizedAt)` within the inactivity window, and `authorizedAt` later than the authorizing account's last password change. An inactive connection is ended on the spot and the call refused.
5. Require `orders:read` in both token and connection.
6. Per tool call: store limit, then «Último uso» (skipped when already written in the current minute, otherwise one conditional update in its own short transaction, never around the tool's reads; a failure is logged and does not refuse the call), then input validation, then the tool.

One tool call costs about 5 to 9 short transactions. Reason for keeping it there: later tool modules must not add per-call lookups to this path; a new one is a design change.

Signing keys come from one JWKS cache per process, shared by the mobile and assistant verifiers: keys are reused for 60 seconds, and a token with an unknown key id forces at most one reload every 30 seconds. Reason: a flood of unknown key ids must not hammer the key table; after a manual key rotation a token signed with the new key can be refused for up to 30 seconds.

### Connections

- One `AssistantConnection` row per store, OAuth client and authorizing account, company-scoped with RLS like every tenant table. Reason: the page lists it per store and any account of the store manages it. The Better Auth `oauth*` tables are global (no RLS, `systemPrisma`), like `session` and `jwks`, and store tokens hashed.
- Ended connections are deleted, not kept; nothing records a history of connections. Disconnecting, inactivity and password reset delete the row and then revoke the client's tokens and stored consent for that account. Revocation is cleanup: once the row is gone `/mcp` refuses the tokens, and a revocation failure is logged while the disconnect still succeeds.
- Inactivity and password changes are evaluated when a token is used or the list is read; there is no scheduled job. The password reset also deletes that account's connections at once; if that cleanup fails it is logged and the call-time check still refuses them.
- Per connection Yoyos keeps the store, the authorizing account, the declared agent name, the return target (domain or this device), the granted scopes, when it was authorized and when it was last used. Not kept: what the agent asked or received, the per-minute counters, the pending authorization request after it is answered or expires. Orders are read current at each call; nothing is copied for the agent.

### Order reads

Tools call the orders feature's composed operations (`orders.listAggregates`, `orders.hasAny`, `orders.getAggregateByNumber`, `orders.describeDispatchStock`, `orders.summarizeUnpaid`, `orders.listDispatchQueue`) and `deliverySettings.listCouriers`, never REST endpoints; `features/assistants` receives them through its dependencies. The unconfirmed-catalog exclusion stays in the orders repository. Readiness is the pure orders function `describeDispatchReadiness`, built on `orderFulfillmentBlock` plus the partially-paid short-stock rule. The dispatch queue is served by the partial index `Order_dispatch_queue_idx`, declared in SQL only like `Order_undeducted_pending_idx` ([Persistence](persistence.md)), and its queries repeat the index predicate as literals so generic plans can use it.

### Adding tools

Tools are grouped in `ToolModule`s, one per data category, each with its scope, `access: "read"`, a paragraph of server instructions and its tools; `src/composition/assistant-tools.ts` lists them. A new category adds a module file in `features/assistants/presentation/tools/`, a scope literal in `domain/scopes.ts`, its consent lines in `app/locales.ts` and one entry in `assistant-tools.ts`; it never edits the server, the transport, the limiter or another module. A connection without the new scope keeps its current tools until the owner authorizes again. A write tool needs its own design: the registry refuses any module that is not read-only.

The static validator, `src/composition/assistant-tools.test.ts` (in `test:unit`, alone with `pnpm --dir apps/core mcp:validate`), connects an MCP client to the in-process server and checks every tool: ASCII name, Spanish title and description, strict input schema, read-only annotations, no write action in names, sample outputs valid against their schema, free of the fixture phone, street and document, and within the 24 KB budget.

## Observability

Events follow [Logging](logging.md). Never logged: tool inputs and outputs, searched numbers, customer data, the declared agent name, tokens, codes or signed queries. `oauthClientId` is a public identifier.

| Event | Level | Meaning |
| --- | --- | --- |
| `assistant_tool_called` | info | One per tool call: company, connection, tool, outcome (`answered`, `empty`, `rate_limited`, `invalid_input`, `not_found`, `failure`), duration. It is how use of the connector is measured. |
| `assistant_access_refused` | info | A `/mcp` request refused, with its reason (`missing_token`, `invalid_token`, `request_limit`, `not_ready`, `no_connection`, `inactive`, `password_changed`, `scope`) |
| `assistant_authorization_answered` | info | Allowed, denied, invalid or expired |
| `assistant_connection_created`, `assistant_connection_ended` | info | Connection lifecycle; ended with its reason |
| `assistant_stale_consent_dropped` | info | The screen guarantee deleted a consent |
| `assistant_consent_refused` | warn | A consent call outside the owner's action |
| `assistant_grant_revocation_failed`, `assistant_connection_touch_failed` | warn | Cleanup or «Último uso» write failed; the operation still succeeded |
| `dispatch_queue_too_large` | warn | The dispatch queue passed its ceiling |
| `assistant_authorize_hook_failed`, `assistant_authorization_failed`, `assistant_password_reset_cleanup_failed`, `assistant_tool_failed` | error | Unexpected failures |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Owner (any account of the store) | Connector address; connected agents with name, domain and dates | Authorize, deny, disconnect | See what an agent asked |
| Connected agent | The store's orders through the four tools, masked | Read | Write anything; read another store; get a full phone, address or document; read customers, products, finances or stock outside the order |
| Someone with the connector address | Nothing | Start an authorization, which requires a Yoyos sign-in | Read any data |

## Known risks

- Never-used dynamic clients and expired plugin token rows are not cleaned up: with open registration and hourly rotation the global `oauthClient` and token tables grow without bound (about 2 000 refresh-token rows per connection in 90 days).
- All limits are per process: more than one web instance multiplies them.
- Past the dispatch-queue ceiling the tool answers the reading-failure text, which invites a retry that will fail the same way. No store is near the ceiling.
- The token endpoint limit (300 per minute per IP) covers about 18 000 connections refreshing hourly from one shared agent egress IP.

## Connecting an agent and checking the server

Claude and ChatGPT cannot reach `localhost`: use the deployed app or a preview reachable from the internet.

**Connect an agent**

1. Yoyos web → Ajustes → **Asistentes de IA** → **Copiar** next to «Dirección del conector».
2. Claude (web or desktop): Settings → Connectors → **Add custom connector**; name «Yoyos», paste the address, **Add**, then **Connect**. ChatGPT: Settings → Apps & Connectors → **Create** (it may ask to enable developer mode in Advanced settings); paste the address, authentication OAuth, **Create**. The agent's plan must allow custom connectors.
3. In the Yoyos window, sign in if asked, check the return line («Volverá a claude.ai» or «chatgpt.com») and tap **Permitir acceso**.
4. Back in «Asistentes de IA», the agent is listed.

**Try it** (expected answer in brackets)

- «¿Qué pedidos tengo que despachar hoy?» (overdue first, then today; blocked ones with the Yoyos reason).
- «¿Quién me debe?» (count and total owed, then the orders).
- «¿Cómo va el pedido 1001?» (full order; phone only as «termina en …», district only).
- «Busca los pedidos de Carla de la semana pasada» (search by name and dates).
- «Cancela el pedido 1001» (the agent says it cannot and gives the Yoyos link).
- In «Asistentes de IA», «Último uso» changed; tap **Desconectar** and ask again (the agent asks to reconnect, and the Yoyos screen appears again).

**Check the server without an agent (MCP Inspector)**

1. Run `npx @modelcontextprotocol/inspector` and open the URL it prints.
2. Transport «Streamable HTTP», the connector address, connection type «Via Proxy»; **Auth Settings** → **Quick OAuth Flow**, sign in and allow (the screen says «Volverá a una aplicación de este equipo»).
3. **Connect** → **Tools** → **List Tools**: exactly the four tools, all read-only. Run each with an empty input or a real order number.

## Decisions

| Decision | Reason |
| --- | --- |
| Read only, no write or payment-decision tool | Writes need their own confirmation design |
| One address for every store; the store comes from the authorization | The address can be shared without exposing anything |
| Phone, street and identity document never complete in any response; digit runs in names and rejection reasons masked | Data in a third-party agent cannot be recalled; a name must never carry a complete phone |
| Phone shown as its last 3 digits, listed in the consent | Tells apart namesakes and nameless buyers; with no phone search it cannot be rebuilt or used to contact the customer (rejected: fully hidden, which leaves nameless buyers indistinguishable) |
| Assistant search never matches names by digits | A masked phone must not be rebuilt by probing |
| 60 calls per minute per store, in memory, resetting on restart | Protects other stores from one agent in a loop; one instance, rare restarts |
| Blocked orders appear in «Pedidos por despachar hoy» with the Yoyos reason, never as ready | The owner must not prepare or promise an order the app will refuse to dispatch |
| A new category of data needs a new authorization | Widening access silently breaks the consent the owner gave |
| Better Auth's OAuth provider, not a custom server | The protocol is the plugin's; Yoyos adds only the hooks that tie it to connections |
| The connection row, not token lifetime, decides access | Disconnect, inactivity and password reset take effect on the next call whatever tokens the agent holds |
| Stateless MCP handler without streams | Every call is an independent read; nothing is lost on deploy |
