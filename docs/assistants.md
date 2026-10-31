# AI assistants

A store owner connects their own AI agent (ChatGPT, Claude, or any agent that accepts a remote MCP connector) to their Yoyos store once, and then asks it in plain language about their orders and products: find an order, see one order in full, what is still unpaid and what has to be dispatched today; which products and variants match a color, size, price range, stock level or catalog presence, and what a variant costs. The agent can only read, sees only the store that authorized it, and never receives a customer's full phone, street address or identity document. The interface calls the agent «asistente» and the owner manages connections on the web page «Asistentes de IA».

Core serves one remote MCP endpoint, `${BETTER_AUTH_URL}/mcp` (`https://app.yoyos.lat/mcp` in production), and acts as the OAuth authorization server for it. Each tool call resolves its token to the same user access and tenant context that cookies and mobile JWTs produce, checks that the store's connection is still active, applies the per-store limit, reads through the orders or products feature and returns a projection that masks customer data.

Code: `apps/core/src/features/assistants/` (connections, access resolution, OAuth hooks, projection, MCP routes and tools), cross-feature wiring in `apps/core/src/composition/assistant-server.ts` and `assistant-tools.ts`, Better Auth configuration in `apps/core/src/shared/infrastructure/auth.ts`, shared JWKS cache in `src/shared/infrastructure/jwks-cache.ts`, fixed-window limiter in `src/shared/infrastructure/fixed-window-limiter.ts`, readiness and dispatch queue in `apps/core/src/features/orders/domain/dispatch-readiness.ts`, product search and detail in `apps/core/src/features/products/application/search-for-assistant.ts` and `find-for-assistant.ts` with the budgeted read in `infrastructure/assistant-read.ts`, stock levels in `features/products/domain/stock-level.ts`, the storefront state in `catalogStorefront.describe` of `features/catalog`, product wiring in `apps/core/src/composition/assistant-product-capabilities.ts`, web routes `apps/core/app/routes/assistant-authorize.tsx` and `assistant-settings.tsx`, texts under `assistants` in `apps/core/app/locales.ts`. Persistence: `AssistantConnection` and the Better Auth `oauth*` models in `apps/core/prisma/schema.prisma`. Initial values of every limit and lifetime: the `ASSISTANT_*` variables in `apps/core/.env.example`.

## Scope

- One connector address for every store; the store comes from who authorizes, never from the address. Reason: the address can be shared without exposing anything.
- Six read-only tools: four for orders, **Buscar pedidos**, **Ver pedido**, **Pedidos por cobrar** and **Pedidos por despachar hoy**, and two for products, **Buscar productos** and **Ver producto**. There is no tool that creates, changes, cancels, registers, approves, rejects, prices, restocks or voids anything. Reason: writes need their own confirmation design.
- Every connection reads all six tools; there is no per-tool or per-category choice. Reason: the consent lists every category the connector reads, and a connection must hold all of them (see [Rules](#rules)).
- The «Asistentes de IA» page is web only. Reason: connecting is done once, where the agent's connector settings live, and it is not a daily operation; cutting an agent from a phone works through the same page in the phone's browser (rejected: a mobile screen and its tests for a one-time task; no page, which would leave a password reset as the only way to cut access).
- An account belongs to one store, so there is no store picker.
- Not supported: customers, finances or stock-alert tools; creating or editing products, prices, stock or variants; a product category (Yoyos has none), margins and profit, sorting by price or stock, searching product descriptions, photos; revealing a full phone, address or document to the agent even if the owner asks; CSV export or a daily summary; a history of what an agent asked or received; a limit that survives a restart.

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

Both web screens follow the interface language (Spanish and Portuguese); the texts here are the Spanish ones. Tool names, input values, descriptions, server instructions and tool messages are written in Spanish for every store, and the agent answers in the language the owner writes in (see [Language](#language)). Reason: Yoyos stores no language per store or owner, and the agent knows the owner's language from the conversation.

### Authorization screen

Route `assistants/authorize` (public layout, also under `:locale`), often opened on a phone.

- Title «ChatGPT quiere leer los pedidos y productos de Tienda Rosa», followed by «(nombre indicado por el asistente)», and under it the return line as body text of the same size and weight as the lists: «Volverá a chatgpt.com», or «Volverá a una aplicación de este equipo» for a loopback redirect. Reason: a hostile site can call itself «ChatGPT»; the return domain is the only part Yoyos verifies. An agent that declares no name gets «Un asistente quiere leer los pedidos y productos de Tienda Rosa».
- «Podrá ver»: «Tus pedidos: productos, montos, pagos, entrega y fechas», «El nombre de tus clientes y de quien recibe el pedido», «Los últimos 3 dígitos del teléfono y el distrito de entrega de tus clientes», «Tus productos: variantes, precios de venta, stock y si están en tu catálogo», «El precio de compra de tus variantes».
- «Nunca podrá»: «Crear, cambiar ni cancelar pedidos, precios ni stock», «Ver teléfonos completos, direcciones ni documentos de tus clientes».
- Footer: «Puedes desconectarlo cuando quieras en Ajustes → Asistentes de IA.» and «Conectado como rosa@ejemplo.com · **Usar otra cuenta**». Main action **Permitir acceso**, secondary **No permitir**.
- **Permitir acceso** shows progress and disables both buttons until the answer arrives. After either answer the screen shows its text while it sends the browser back, so the owner never lands on a blank page if the agent cannot be opened from the browser.
- Invalid or altered request: «Este enlace de conexión no es válido. Vuelve a tu asistente y conecta de nuevo.» Expired request: «Esta solicitud venció. Vuelve a tu asistente y conecta de nuevo.» A request that cannot be read: «No pudimos cargar la solicitud. Vuelve a tu asistente y conecta de nuevo.»
- The screen cannot be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`). Reason: clickjacking of the consent.
- Accessibility: the title is the page heading and reads as one sentence with the return line; each list has its own heading and is a real list, not distinguished by color alone; **Usar otra cuenta**, **Permitir acceso** and **No permitir** have at least the touch target of the navigation links and a visible focus ring.

### «Asistentes de IA»

Route `settings/assistants` (private layout, also under `:locale`), in the Settings navigation after «Catálogo».

- Intro: «Conecta ChatGPT, Claude u otro asistente para preguntarle por tus pedidos y productos. Solo puede leer: no crea, cambia ni cancela nada.»
- «Dirección del conector»: the address shown complete (it wraps, never truncated) and **Copiar**. After copying, «Dirección copiada.», announced politely; if the browser blocks the clipboard, «No pudimos copiarla. Selecciona la dirección y cópiala.». «MCP» never appears in the interface. Reason: owners know «asistente»; vendors ask only for the address.
- «Cómo conectarlo»: three steps that do not name each vendor's menus, which change without notice, plus «Tu plan del asistente debe permitir conectores personalizados.». It is open while the store has no connection and collapsed under a disclosure that announces its state once there is one, so the page becomes the address and the list.
- «Asistentes conectados», newest authorization first: agent name («Asistente» when it declared none), return domain («Una aplicación de este equipo» for loopback), «Conectado el 30/10/2026», «Último uso: hoy, 10:42», «Último uso: 28/10/2026, 10:42» or «Sin uso todavía», and **Desconectar**. Dates and times in America/Lima. Under the list and under the empty state: «Los asistentes se desconectan solos tras 90 días sin uso o si cambias tu contraseña.», so an owner whose agent stopped working knows where its row went.
- The list loads apart from the address and steps, which render even when it fails, and reloads when the tab regains focus, so an agent connected from another tab appears without reloading. States: a placeholder while loading; «Todavía no conectaste ningún asistente.»; «No pudimos cargar la lista de asistentes.» with **Reintentar**. All connections are listed.
- **Desconectar** asks «¿Desconectar ChatGPT, conectado el 30/10/2026?» with «Dejará de ver tus pedidos y productos hasta que lo conectes de nuevo.», **Desconectar asistente** and **Mantener conectado**. The date tells apart two rows of the same agent. Success removes the row, announces «Desconectaste ChatGPT, conectado el 30/10/2026.» and moves focus to the next row's **Desconectar** or to the «Asistentes conectados» heading. Failure shows «No pudimos desconectarlo. Inténtalo de nuevo.» next to the row, announced, with focus back on its **Desconectar**, and the list reloads; the row stays only if the connection is still active.
- Errors use the «No pudimos…» voice and the retry and confirmation components of Settings → Catálogo. The page follows the authorization screen's accessibility rules, because it is the emergency path from a phone.

## Tools

Each tool has a stable ASCII identifier, a Spanish display title and a Spanish description written for the agent: when to use it, when to use another, the exact values each input accepts and how to read the result. Tools are grouped in modules by data category, each with its own scope and reading-failure text.

| Identifier | Title | Answers |
| --- | --- | --- |
| `buscar_pedidos` | Buscar pedidos | General search by customer, number, state or dates |
| `ver_pedido` | Ver pedido | Everything about one order named by number |
| `pedidos_por_cobrar` | Pedidos por cobrar | «¿Quién me debe?», «¿cuánto me falta cobrar?» |
| `pedidos_por_despachar_hoy` | Pedidos por despachar hoy | «¿Qué despacho hoy?», «¿qué preparo?» |
| `buscar_productos` | Buscar productos | «¿Tienes polos azules en M?», «¿qué se me está acabando?» |
| `ver_producto` | Ver producto | Every variant of one product, with its purchase price: «¿cuánto me costó la casaca negra?» |

The server instructions, shown to the agent once, say: Yoyos is the store's sales tool and this connector only reads; answer in the language the owner writes in, using only what the tools return and keeping store data unchanged (see [Language](#language)); amounts, dates and states come ready to show; wait the seconds the limit gives and never retry in a loop; to change an order, send the owner to Yoyos with the order link; customer phones and addresses are hidden on purpose and the agent must not claim it can get them; on a not-authorized refusal, ask the owner to reconnect from the agent's settings (the address is in Yoyos → Ajustes → Asistentes de IA); there are no sales totals or finances, so say so instead of adding pages of orders; convey a readiness reason's meaning, in the owner's language, without turning it into a promise, and «Tiene un pago por revisar.» means reviewing that report in Yoyos, not registering a payment; compute relative ranges from the «Hoy es …» line, not from the agent's clock. The product paragraph adds: Yoyos has no product categories, so a type of product is searched by name; the purchase price is for the owner and is not offered in a text meant for a customer; never add costs up to compute margins; stock is the current count, not a reservation; mention a hidden catalog once per conversation unless the owner asks about it.

### Language

- The agent answers in the language the owner writes in (for example Spanish or Portuguese), for every tool. Tool texts come in Spanish and the agent translates them, without changing product names, combinations, values, SKUs, links, amounts, dates or order numbers, which are the store's data.
- No server instruction, tool title or description says to answer in Spanish or to quote a text «tal cual»; the static validator refuses both. Reason: an owner writing in Portuguese must not get Spanish answers.
- Tool names, input values («stock bajo», «por cobrar») and messages stay in Spanish for every store: the agent reads them, not the owner.

### Common rules

| Aspect | Behavior |
| --- | --- |
| Store | Always the authorized store. No tool accepts a store. |
| Order identity | The visible number; «1001» and «#1001» are the same. Reason: it is what owner and customer say in the chat. |
| Customer | The buyer's name. A buyer without a usable name: «Cliente que termina en 427». No buyer, or neither name nor phone: «Público general». Phone only as «termina en 789». Never an identity document. |
| Destination | Home delivery: district, province and department only («Miraflores, Lima, Lima»). Agency: courier, agency and the agency's own address, which is business data. Store pickup: «Recojo en tienda» and the pickup point with its address. No delivery: «Entrega por definir». |
| Amounts | In the order's currency, or the store currency for products, as the web formats them: «S/ 120.00». |
| Date inputs | `AAAA-MM-DD`, whole inclusive days in America/Lima; any other format is refused with the remedy. |
| Dates shown | «30/10/2026», times «30/10/2026 10:42», in America/Lima. «Hoy» is today in Lima whatever the agent's zone; every list states «Hoy es 30/10/2026». |
| States | The web's words: «Pagado» or «Pago pendiente» with what is owed; «Pendiente», «Enviada», «Entregada»; «Cancelado», «Completado»; «Pago por revisar» while a buyer report awaits review. The checkout confirmation label is not returned. |
| Source | «Desde el catálogo», «WhatsApp», or «Venta manual» for an order the seller created (the web shows no label for it, and the agent needs a word). |
| Unconfirmed catalog orders | Do not exist for any tool, as in every Yoyos screen ([Public catalog · Rules](public-catalog.md#rules)); **Ver pedido** answers them like a nonexistent number. Reason: the agent must not see what the owner cannot. |
| Link | Each order carries its Yoyos web link, `${BETTER_AUTH_URL}/orders/<id>`. |
| Lists | Newest created first unless the tool says otherwise, 20 per page, with the total (of orders or products, not variants) and «hay más: pide la página 2». |
| Output | Field names in Spanish snake case. Product names are shortened to 100 characters, combinations to 50 and rejection reasons to 100, so a large order stays within the response budget; in product lists SKUs are shortened to 40. |

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

### Buscar productos

- Optional inputs, combinable: `texto` (up to 120 characters), `valores` (1 to 3 entries, each «Azul» or «Color: Azul», up to 30 characters per name), `precio_desde` and `precio_hasta` (up to two decimals, store currency, both ends inclusive), `stock` («con stock», «stock bajo» or «agotado»), `en_catalogo` («sí» or «no»), `orden` («recientes», the default, or «nombre» A–Z) and `pagina`. Lists are 20 per page, with the total.
- **Text** is one phrase matched partially, ignoring case and accents, on the product name or any variant SKU (active or not). It is not split into words: «polo azul» finds only names containing «polo azul»; colors and sizes go in `valores`. Descriptions are not searched. Reason: the name and SKU search of the app list, made accent-insensitive.
- **Product types:** Yoyos has no category, so the description tells the agent to search one short singular word or stem, with the examples «polo» for «polos» and «casac» for «casacas» written literally, and to try a shorter one before saying there is none. Yoyos applies no plural or synonym rules. Reason: understanding words belongs to the model (rejected: a category field nobody can set, which would match nothing).
- **Variant filters** (`valores`, price range, `stock`) apply together to one active variant: a product matches when at least one of its active variants meets all of them. Example: with «M / Azul» at S/ 39.90 and 2 units and «L / Rojo» at S/ 45.00 and 10, `valores: ["Azul"]`, `stock: "con stock"` and `precio_hasta: 40` match through «M / Azul»; `valores: ["Rojo"]` with `precio_hasta: 40` does not. Reason: «azul en M con stock» must mean one sellable variant. Deactivated variants are never matched, so `en_catalogo: "no"` with a variant filter is refused: «Los filtros de variante (valores, precio y stock) solo miran variantes activas, y los productos que no están en el catálogo no tienen ninguna. Quita esos filtros o en_catalogo.».
- **Values** match exactly on the whole name, ignoring case, accents and surrounding spaces: «azul» matches «Azul», «M» does not match «Mostaza». With «Opción: valor» the option must match too; an entry splits at its first colon only when the left side is an option of the store, so values such as «3:4» stay reachable. There are no word lists, synonyms or plural rules: the agent maps the owner's words to the store's values.
- **Unknown value or option** answers the store's vocabulary so the agent can retry in one call: every option of the store's products with its values held by an active variant, options in alphabetical order, values in the order the seller saved them taking products newest first (so «S, M, L» stays in that order), a value spelled differently across products listed once as written in the newest one, at most 100 values and «y 20 valores más» when cut. Texts: «Tu tienda no tiene el valor "Celeste". Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.», «Tu tienda no tiene el valor "M" en Color. Valores de tu tienda: …», «Tu tienda no tiene la opción "Material". Valores de tu tienda: …» and, for a store whose products have no options, «Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto.». A value held only by deactivated variants counts as unknown, because it can never match.
- A reversed price range answers «El precio hasta (S/ 20.00) es menor que el precio desde (S/ 50.00).»; a negative amount or more than two decimals is refused with the remedy.
- **Each product:** name; SKU (the variant's when it has one variant, «Varias variantes» or «Sin SKU»); price over its active variants as the app list shows it, «S/ 39.90» or «Desde S/ 39.90», or «Sin variantes activas» when it has none; stock, the total of its active variants plus the summary of their levels («Stock: 12 · 1 agotada, 1 con stock bajo», «Stock: 0 · Agotado»; no stock line and no level for a product without active variants, never «Agotado»); «En el catálogo» or «No está en el catálogo: sin variantes activas»; number of variants («6 variantes, 1 desactivada»); its Yoyos link `${BETTER_AUTH_URL}/products/<id>`; the customer link («Link para tu cliente», `https://rosa.yoyos.lat/productos/<id>`) only when the catalog is published, the product is in the catalog and the product currency is the store currency, the public catalog's own filter ([Public catalog · Rules](public-catalog.md#rules)); and, with a variant filter, the matching variants (combination, SKU, sale price, stock, level), at most 10 per product followed by «y 4 variantes más: usa Ver producto». SKUs in lists are shortened to 40 characters. Never the purchase price.
- **Every answer, empty ones included,** carries the catalog line: «Tu catálogo está publicado en https://rosa.yoyos.lat/.», «Tu catálogo está oculto: ahora nadie ve tus productos.» or «Tu catálogo está oculto y no tiene link todavía.».
- Empty answers repeat the filters applied («No hay productos con esos filtros: texto "polos", stock bajo.»); a store with no products, including when `valores` is sent, answers «Tu tienda todavía no tiene productos.».
- A page of 20 products at maximum lengths, with or without 3 matching variants each, fits the 24 KB budget; neither the page size nor the 10-variant cap shrinks silently.

### Ver producto

- Input: exactly one of `producto`, the identifier returned by **Buscar productos**, or `sku`, an exact SKU (case and surrounding spaces ignored). A SKU belongs to one variant: it opens that variant's product and marks the variant «Buscada por SKU», so the agent answers about it first.
- Returns name, description (up to 1,000 characters; a longer one ends «… (la descripción continúa en Yoyos)» so it is not presented as complete), the options with their values in saved order, the catalog line, «En el catálogo» or not, the customer link under the same condition as in the search, the total stock of the active variants with its level summary, every variant in saved order (up to the 100 a product can have) and the Yoyos link.
- Each variant: combination, SKU («Sin SKU»), sale price, purchase price («Sin precio de compra» when the seller never entered one; «S/ 0.00» only when the seller entered 0), stock, level, «Activa» or «Desactivada». SKUs and option values are shown whole.
- A product of 60 variants with a 1,000-character description at maximum ASCII lengths fits the 24 KB budget; a larger product, or the same text in two-byte characters, still answers complete, never cut and never with the reading-failure text.
- An unknown identifier, an unknown SKU and another store's product or SKU answer the same: «No encontré ese producto en tu tienda. Búscalo con Buscar productos.». A `producto` that is not an identifier answers the same without reading.

### Stock levels

«Agotado» and «stock bajo» are levels of **one active variant**, never of a product total: «Agotado» is 0 units, «Stock bajo» is 1 to 3 units, and «con stock» is 1 or more (low included). The threshold is one constant for every store, changed only by Yoyos (`lowStockThreshold` in `features/products/domain/stock-level.ts`). Reason: it fits small clothing stock without configuration (rejected: 1 to 5, which is noisier; an owner-configured threshold, which needs a settings screen).

- The `stock` filter uses these levels per variant: «stock bajo» returns products with at least one active variant at 1 to 3 units, «agotado» with at least one at 0, «con stock» with at least one above 0.
- The product line only counts its active variants at each level and says «Agotado» only when every active variant is at 0. A product with one variant shows that variant's level. Deactivated variants have no level and do not count.
- Examples: S = 0, M = 2, L = 10 → «Stock: 12 · 1 agotada, 1 con stock bajo», returned by all three filters; six sizes at 1 unit → «Stock: 6 · 6 con stock bajo», returned by «stock bajo» and «con stock» but not «agotado»; S = 0, M = 0 → «Stock: 0 · Agotado».
- The stock-alert tool of a later task reuses these levels and the threshold; if the threshold changes, this filter and these summaries change with it.

### Dispatch readiness

Readiness follows the rules of the web's «Marcar enviado» and «Marcar entregado» buttons ([Orders · Fulfillment buttons](orders.md#fulfillment-buttons)), payment first, then stock, with the same sentences (`orderFulfillment` in `app/locales.ts`), so the tool and the button never drift.

| Order | Readiness |
| --- | --- |
| Home or agency, at least one confirmed payment, enough stock (deducted, deducting, or available for every item) | «Listo para enviar» |
| Home or agency, no confirmed payment | «Se requiere al menos un pago para enviar.» |
| Store pickup, at least one confirmed payment (partial or full), enough stock | «Listo para entregar» |
| Store pickup, no confirmed payment | «Registra al menos un pago para entregar. Puede ser un pago parcial. Por cobrar: S/ 40.00.» |
| Home or agency waiting for stock, or partially paid with an item's current stock below its quantity | «Para enviar falta stock de Camisa (M · Azul).», naming only the short items |
| Store pickup waiting for stock | «Para entregar falta stock de Camisa (M · Azul).» |
| No delivery assigned | «Entrega por definir: falta asignar la entrega.» |

- A payment reason adds «Tiene un pago por revisar.» when the buyer has a report awaiting review, so the owner reviews it instead of registering a duplicate payment.
- A partially paid order with short stock is not «Esperando stock» in Yoyos and its button stays enabled until the tap fails; the tool marks it with the stock sentence anyway. Reason: the owner must not prepare an order Yoyos will refuse to ship or deliver.
- A cancelled order shows only «Cancelado», with no readiness.
- Readiness is computed per order at the moment of the call and reserves no stock among the listed orders: two orders each needing 3 of a variant with 4 in stock both show ready, and only the first shipped succeeds. The description tells the agent to warn about this when ready orders share a product.

## Rules

| Aspect | Behavior |
| --- | --- |
| Read only | A tool call records only its connection's «Último uso» and its log line. Every tool module declares `access: "read"` and its tools carry the read-only annotations; the validator refuses anything else. |
| Store isolation | A connection reads only the store that authorized it; another store's order number, product, SKU, option value or link answers as nonexistent. |
| Current data | Every call reads orders, products, prices and stock as they are now; nothing is copied for the agent. Stock is the current count, not a reservation. |
| Consent scope | A connection reads only what its consent listed, and must hold every current data scope (`orders:read` and `products:read`); every authorization grants all of them. A connection missing any current scope is hidden from «Asistentes de IA» and ended lazily as `consent_outdated`: its next call is refused as not authorized and its row and grant are deleted, and the agent starts authorization again on the normal screen, now listing the new category. A later category of data therefore ends older connections instead of being granted silently or offered as a partial reauthorization. Reason: the owner consented to what the screen listed, and re-adding a connector registers a new client, so a partial reauthorization state could not be reached (rejected: granting silently, which breaks the consent; a rule limited to the newest scope, which would leave older connections without the new tools and without ever showing their consent). |
| Who can authorize | Any signed-in, verified account with a store. There are no roles; the connection belongs to the store and records which account authorized it. Any account of the store can disconnect any of its connections. |
| Product data | The store's own data, not customer data: no masking applies to product names, descriptions or SKUs. Exact stock and SKUs are sent. The purchase price is the owner's commercial data: only **Ver producto**, listed in the consent, never in a search list, which an owner may paste into a customer chat. QR identifiers, photos and internal ids other than the product links are never sent. Reason: the agent acts for the owner, who sees stock in the app; the public catalog's rule against exposing quantities protects the store from buyers, not from its owner. |
| Masking | In every response of every tool: phone only as its last 3 digits, no street, no reference, no identity document. Names are shown with long digit runs masked (see [Masking](#masking)). The owner cannot turn masking off. Reason: data in a third-party agent's history cannot be recalled. |
| Store limit | 60 tool calls per minute per store, shared by all its connections and by order and product tools, in fixed one-minute windows. Discovering tools and connecting do not count. A refused call changes nothing else. Other stores are not affected. Reason: one agent in a loop must not degrade Yoyos for every other store. |
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
| Reading failed | Each module has its own text: «No pudimos leer tus pedidos en este momento. Inténtalo de nuevo en unos segundos.» for orders and «No pudimos leer tus productos en este momento. Inténtalo de nuevo en unos segundos.» for products; never an empty list |
| Product read slower than its budget, or too many product reads at once | The products reading-failure text |
| Connection authorized before a data category existed | The protocol's not-authorized answer (the connection was ended as `consent_outdated`); the agent starts authorization again and the owner allows on the normal screen |

A read has no doubtful outcome with effect: repeating a call is always safe.

## Masking

The projection in `features/assistants/domain/order-projection.ts` is the only code that reads an order's buyer, recipient and destination, and its output types have no field that can hold a full phone, a street, a reference or a document. Tool output schemas are strict; an output that fails its schema is never sent and the call answers the module's reading-failure text.

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
- Each tool returns `structuredContent` and one text block with the same compact JSON. The JSON stays under 24 KB for a twenty-order page and for an order of 60 lines and 10 payments, for a page of twenty products and for a product of 60 variants at maximum lengths; a larger answer is still sent complete. Business refusals (not found, invalid input, store limit, reading failure) are tool results with `isError: true`, a Spanish message and no `structuredContent` (clients on the v1 SDK validate it against the output schema even on errors); a store-limit refusal carries `retryAfterSeconds` in `_meta`. Only authorization failures are HTTP errors.

### Authorization server

- Better Auth's `@better-auth/oauth-provider` plugin: RFC 8414 metadata, RFC 7591 dynamic client registration, authorization code with PKCE (`S256`), refresh-token rotation, RFC 8707 resource indicators and revocation. Metadata: `/.well-known/oauth-protected-resource/mcp` (RFC 9728, also without the suffix) and `/.well-known/oauth-authorization-server`. The OpenID discovery and the introspection endpoint are not served or advertised. Reason: Yoyos is an OAuth server here, not an OpenID provider.
- Open dynamic registration of public clients. Redirect URIs must be `https` with a non-loopback host or `http` on `127.0.0.1`, `[::1]` or `localhost`, without userinfo or fragment, both at registration and at `/authorize`, where the URI must also be registered for that client. Reason: it is what ChatGPT, Claude and other MCP clients use; sign-in and consent protect the data, and only those URIs have a return target the screen can state truthfully (rejected: a redirect allowlist, which contradicts «any agent» and needs a release per agent; Client ID Metadata Documents alone, which lock out agents that only register).
- Every plugin endpoint other than `register`, `authorize`, `token`, `revoke` and `consent` is disabled (`404`). Reason: the client-management endpoints would let any signed-in user create clients outside the registration rules and its limit.
- The consent endpoint answers only inside the server-side call made by the owner's **Permitir acceso** or **No permitir** (an in-process marker scoped to that call, client and account); neither the browser nor other code can accept or deny a consent. Reason: the only path that issues a code after consent is the one that saves the connection.
- Scope: a sent scope at registration and every requested scope at `/authorize` are replaced by `orders:read products:read offline_access`. Reason: the consent screen lists what this version reads, `offline_access` keeps the refresh token alive when the owner signs out, and agents that ask for `openid` or nothing still connect.
- One protected resource, `${BETTER_AUTH_URL}/mcp`. Access tokens are JWTs (`typ` `at+jwt`, `EdDSA`) with that audience, signed with the existing `jwt` plugin keys.
- Lifetimes (initial values, adjustable by environment): access token 1 hour; refresh token 90 days with rotation; a just-rotated refresh token reusable for 10 seconds, because the plugin otherwise treats any reuse as replay and revokes the grant of an agent that refreshed concurrently or retried; authorization request 10 minutes from the last redirect to the sign-in or the screen, so sign-in time does not count. Token lifetime never decides whether a connection is active; the connection row does.
- **Client scopes**: the plugin refuses an `/authorize` whose scope is not a subset of the client's stored scopes (`invalid_scope`) and checks it before it reads the session. Before that, the `/authorize` hook sets the client's stored scopes to the current set with one conditional update of the global `oauthClient` row (a no-op when the sets already match; it runs only on `/authorize`, never on `/mcp`). Reason: a client registered before a category existed must still reach the sign-in and the screen; a hook aligns on demand for every later scope with no migration. The write is acceptable unauthenticated because it can only set the exact scopes that open dynamic registration already grants.
- OAuth endpoint rate limits per client IP and minute, in memory: register 5, authorize 30, token 300 (agents refresh from shared egress IPs). The client IP is the first `x-forwarded-for` address that is not one of `ASSISTANT_TRUSTED_PROXIES`.
- **Screen guarantee**: without an active connection for the client and account, the authorization screen is shown. Before the plugin looks up a stored consent on `/authorize` (the agent's request and the continuation after sign-in), Yoyos revokes that client's and account's prior grant (refresh and access tokens, and the stored consent) when no active connection exists, except in the authorize nested in the owner's own allow. Reason for revoking tokens too: a connection ended as outdated, or after a password change whose cleanup failed, must not leave refresh tokens that work for 90 days once the row is reactivated. Unparseable parameters fail with `400` and a failure reading session, access or connection fails with `503`, never falling through to a possibly stale consent. Reason: a failed save, a failed revocation or an ended connection must never let an agent skip the screen.
- On **Permitir acceso** the consent is accepted first and the connection saved second; the code reaches the agent only through the redirect returned after the save. Reason: an expired or rejected request never leaves a row, and an issued code whose save failed is never delivered (its grant is revoked on the next attempt). Concurrent first taps land on one row.
- Request forgery: the allow, deny and switch actions are React Router actions protected by the request-origin check and the `SameSite=Lax` session cookie.

### Access per call

1. Verify the JWT: `alg` `EdDSA`, `typ` `at+jwt`, `iss` `BETTER_AUTH_URL`, `aud` the MCP resource, strict claims, lifetime at most the access-token TTL. The token's session is not checked, because a connection outlives sign-out by design. A mobile JWT (`aud` `yoyos-core-api`) is refused here and an MCP token is refused on `/api`.
2. Coarse limit: 300 `POST /mcp` per minute per account and client, before any database read.
3. Resolve the user through `loadUserAccess`, the same loader as cookies and mobile JWTs; anything but a verified user with a store is not authorized. The token carries no company: the company comes from the user, and the rest of the request runs inside `withTenantIsolation` ([RLS with Prisma](rls-with-prisma.md)).
4. Find the connection by client and account and check it is active: `authorizedAt` later than the authorizing account's last password change, the connection holding every scope the server requires (`assistantScopes`), and `coalesce(lastUsedAt, authorizedAt)` within the inactivity window, checked in that order. An inactive connection is ended on the spot, with its reason, and the call refused.
5. Expose only the tools of the scopes held by both token and connection; a call with no scope in common is refused.
6. Per tool call: store limit, then «Último uso» (skipped when already written in the current minute, otherwise one conditional update in its own short transaction, never around the tool's reads; a failure is logged and does not refuse the call), then input validation, then the tool.

One tool call costs about 5 to 9 short transactions. Reason for keeping it there: later tool modules must not add per-call lookups to this path; a new one is a design change.

Signing keys come from one JWKS cache per process, shared by the mobile and assistant verifiers: keys are reused for 60 seconds, and a token with an unknown key id forces at most one reload every 30 seconds. Reason: a flood of unknown key ids must not hammer the key table; after a manual key rotation a token signed with the new key can be refused for up to 30 seconds.

### Connections

- One `AssistantConnection` row per store, OAuth client and authorizing account, company-scoped with RLS like every tenant table. Reason: the page lists it per store and any account of the store manages it. The Better Auth `oauth*` tables are global (no RLS, `systemPrisma`), like `session` and `jwks`, and store tokens hashed.
- Ended connections are deleted, not kept; nothing records a history of connections. Disconnecting, inactivity, password reset and an outdated consent delete the row and then revoke the client's tokens and stored consent for that account. Revocation is cleanup: once the row is gone `/mcp` refuses the tokens, and a revocation failure is logged while the disconnect still succeeds.
- Inactivity, password changes and missing scopes are evaluated when a token is used or the list is read; there is no scheduled job. The password reset also deletes that account's connections at once; if that cleanup fails it is logged and the call-time check still refuses them.
- Per connection Yoyos keeps the store, the authorizing account, the declared agent name, the return target (domain or this device), the granted scopes, when it was authorized and when it was last used. Not kept: what the agent asked or received, the per-minute counters, the pending authorization request after it is answered or expires. Orders are read current at each call; nothing is copied for the agent.

### Order and product reads

Tools call the orders feature's composed operations (`orders.listAggregates`, `orders.hasAny`, `orders.getAggregateByNumber`, `orders.describeDispatchStock`, `orders.summarizeUnpaid`, `orders.listDispatchQueue`) and `deliverySettings.listCouriers`, never REST endpoints; `features/assistants` receives them through its dependencies. Product tools call composed operations of the products feature (`products.readForAssistant`, `products.searchForAssistant`, `products.findForAssistant`) and `catalogStorefront.describe` of the catalog feature, never REST endpoints or another feature's repository. `features/assistants` imports nothing from `features/products` or `features/catalog`: it declares its own ports and projectable types and `src/composition/assistant-product-capabilities.ts` maps between them, as it does for orders. The assistant sends plain data (text, raw `valores` strings, integer cents, literal unions) and the products feature parses it. The unconfirmed-catalog exclusion stays in the orders repository. Readiness is the pure orders function `describeDispatchReadiness`, built on `orderFulfillmentBlock` plus the partially-paid short-stock rule. The dispatch queue is served by the partial index `Order_dispatch_queue_idx`, declared in SQL only like `Order_undeducted_pending_idx` ([Persistence](persistence.md)), and its queries repeat the index predicate as literals so generic plans can use it.

Each product call runs in one RepeatableRead snapshot together with the storefront read, so the page, the total, the vocabulary and the catalog line never disagree with a concurrent save. The snapshot has fixed constants, not environment variables: 1 s to get a connection, 5 s for the transaction, 350 ms per statement and JIT off, for at most 11 statements (a search needs at most 7, a detail by SKU at most 11; the count does not grow with the number of products or variants), and a unit test pins `maxStatements × statementTimeoutMs + maxWait ≤ timeout`. At most 3 product reads are in flight per process, shared by every store; a 4th call waits up to 300 ms for a slot and then answers the products reading-failure text. Reason: product calls hold at most 3 of the 10 pool connections, so the web app and the order tools always keep 7. A statement over its limit or an exhausted pool answers the reading-failure text, never an empty list.

Product queries filter by company explicitly and use the existing indexes that lead with `companyId`; no index was added. The accent-insensitive text match, the value vocabulary and the SKU lookup cost grows with the store's own products and variants, never with other companies'. Above roughly 12,000 products in one store an all-filters search can exceed its statement limit and answers the reading-failure text. The SKU lookup is not served by the SKU expression index under row-level security (`lower` and `btrim` are not leakproof), so it scans the store's variants; it stays small. Value matching normalizes in TypeScript (one normalizer: accents and combining marks removed, lower case, trimmed) and SQL filters by the written spellings with plain equality.

The search filters stay internal to `features/products`; `shared/contracts/products.ts` and the app list do not change. Reason: no second application consumes them yet, and the app list's «sold out» is a product-level rule while the assistant's «agotado» is variant-level.

### Adding tools

Tools are grouped in `ToolModule`s, one per data category, each with its scope, `access: "read"`, a paragraph of server instructions and its tools; `src/composition/assistant-tools.ts` lists them. Each module also carries its own reading-failure text, which the registry uses for an output that fails its schema and for a failed read. A new category adds a module file in `features/assistants/presentation/tools/`, a scope literal in `domain/scopes.ts`, its consent lines in `app/locales.ts` and one entry in `assistant-tools.ts`; it never edits the server, the transport, the limiter or another module. Adding the literal to `assistantScopes` also ends older connections that lack it (see [Rules](#rules)). A write tool needs its own design: the registry refuses any module that is not read-only.

The static validator, `src/composition/assistant-tools.test.ts` (in `test:unit`, alone with `pnpm --dir apps/core mcp:validate`), connects an MCP client to the in-process server and checks every tool: ASCII name, Spanish title and description, strict input schema, read-only annotations, no write action in names, sample outputs valid against their schema, free of the fixture phone, street and document, within the 24 KB budget, and free of any instruction, title or description that tells the agent to answer in Spanish or to quote a text «tal cual».

## Observability

Events follow [Logging](logging.md). Never logged: tool inputs and outputs, searched numbers, search text, values, SKUs, prices, product names, the store subdomain, customer data, the declared agent name, tokens, codes or signed queries. `oauthClientId` is a public identifier.

| Event | Level | Meaning |
| --- | --- | --- |
| `assistant_tool_called` | info | One per tool call: company, connection, tool, outcome (`answered`, `empty`, `rate_limited`, `invalid_input`, `not_found`, `failure`), duration. It is how use of the connector is measured. |
| `assistant_access_refused` | info | A `/mcp` request refused, with its reason (`missing_token`, `invalid_token`, `request_limit`, `not_ready`, `no_connection`, `inactive`, `password_changed`, `consent_outdated`, `scope`) |
| `assistant_authorization_answered` | info | Allowed, denied, invalid or expired |
| `assistant_connection_created`, `assistant_connection_ended` | info | Connection lifecycle; created with its outcome (`inserted` or `reactivated`), ended with its reason (including `consent_outdated`) |
| `assistant_prior_grant_revoked` | info | The screen guarantee revoked a prior grant (consents and tokens) |
| `assistant_client_scopes_aligned` | info | A registered client's stored scopes were set to the current set, written only when they differed |
| `assistant_consent_refused` | warn | A consent call outside the owner's action |
| `assistant_grant_revocation_failed`, `assistant_connection_touch_failed` | warn | Cleanup or «Último uso» write failed; the operation still succeeded |
| `dispatch_queue_too_large` | warn | The dispatch queue passed its ceiling |
| `assistant_product_reads_busy` | warn | A product call found no free read slot after its 300 ms wait |
| `product_search_failed` | error | A budgeted product read failed, with its operation (`search` or `detail`) and error code (`PERSISTENCE_UNAVAILABLE`, `STATEMENT_TIMEOUT` or `TRANSACTION_TIMEOUT`) |
| `assistant_authorize_hook_failed`, `assistant_authorization_failed`, `assistant_password_reset_cleanup_failed`, `assistant_tool_failed` | error | Unexpected failures |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Owner (any account of the store) | Connector address; connected agents with name, domain and dates | Authorize, deny, disconnect | See what an agent asked; grant orders without products or the reverse |
| Connected agent | The store's orders, masked, and its products through the six tools: options, values, variants, SKUs, sale prices, stock and levels, active or deactivated, catalog presence, catalog and customer links, and the purchase price of each variant in **Ver producto** | Read | Write anything; read another store; get a full phone, address or document; read customers or finances; get photos or QR codes |
| Someone with the connector address | Nothing | Start an authorization, which requires a Yoyos sign-in | Read any data |

## Known risks

- Never-used dynamic clients and expired plugin token rows are not cleaned up: with open registration and hourly rotation the global `oauthClient` and token tables grow without bound (about 2 000 refresh-token rows per connection in 90 days).
- Margins have no tool: the agent sees one variant's purchase price in **Ver producto** and the instructions tell it not to add costs up.
- No server guard keeps a product's currency equal to the store's. Such a product shows «En el catálogo» without a customer link, as the public catalog would not list it.
- The three product read slots are shared by every store the process serves, so one store's burst can make another store's product call wait up to 300 ms and then answer the reading-failure text.
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
- «¿Tienes polos azules en M?» (products with a matching active variant, its price and stock level, and the customer link when the catalog is published).
- «¿Cuánto me costó la casaca negra?» (the purchase price, only from **Ver producto**).
- «¿Qué categorías tengo?» (the agent says Yoyos has no categories and offers to search by name).
- In Portuguese, «Quais camisetas azuis eu tenho?» (the answer comes in Portuguese with names, values and amounts unchanged).
- «Cancela el pedido 1001» (the agent says it cannot and gives the Yoyos link).
- In «Asistentes de IA», «Último uso» changed; tap **Desconectar** and ask again (the agent asks to reconnect, and the Yoyos screen appears again).

**Check the server without an agent (MCP Inspector)**

1. Run `npx @modelcontextprotocol/inspector` and open the URL it prints.
2. Transport «Streamable HTTP», the connector address, connection type «Via Proxy»; **Auth Settings** → **Quick OAuth Flow**, sign in and allow (the screen says «Volverá a una aplicación de este equipo»).
3. **Connect** → **Tools** → **List Tools**: exactly the six tools, all read-only. Run each with an empty input or a real order number or product identifier.

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
| A new category of data ends older connections and the owner connects again on the normal screen | Widening access silently breaks the consent the owner gave; a partial reauthorization is unreachable because re-adding a connector registers a new client |
| A connection must hold every current data scope | Older connections never keep working without the new tools or hide a consent the owner never saw; later tasks only add their scope literal |
| Product search has no category filter; the agent searches product types by name | Yoyos has no category; a field nobody can set would match nothing |
| Variant filters apply together to one active variant; value matching is exact without word lists | «Azul en M con stock» must mean one sellable variant; understanding words belongs to the model |
| Stock levels belong to one active variant; product lines only count them | One meaning of «stock bajo» for the filter, the product line and later stock alerts |
| Purchase price only in **Ver producto** | Owner's commercial data, asked directly and listed in the consent; lists may be pasted to customers |
| The agent answers in the owner's language; tool texts stay in Spanish | Yoyos stores no language per store or owner |
| Reading-failure text per module | A product failure must not tell the owner their orders failed |
| Product reads in one budgeted snapshot with at most 3 in flight | A slow query or a burst must not exhaust the pool shared with the web app and order tools |
| Better Auth's OAuth provider, not a custom server | The protocol is the plugin's; Yoyos adds only the hooks that tie it to connections |
| The connection row, not token lifetime, decides access | Disconnect, inactivity and password reset take effect on the next call whatever tokens the agent holds |
| Stateless MCP handler without streams | Every call is an independent read; nothing is lost on deploy |
