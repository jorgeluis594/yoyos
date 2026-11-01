# AI assistants

A store owner connects their own AI agent (ChatGPT, Claude, or any agent that accepts a remote MCP connector) to their Yoyos store once, and then asks it in plain language about their orders and products: find an order, see one order in full, what is still unpaid and what has to be dispatched today; which products and variants match a color, size, price range, stock level or catalog presence, what a variant costs, how a period of sales went and what sold most or did not sell at all. The agent can only read, sees only the store that authorized it, and never receives a customer's full phone, street address or identity document. The interface calls the agent «asistente» and the owner manages connections on the web page «Asistentes de IA».

Core serves one remote MCP endpoint, `${BETTER_AUTH_URL}/mcp` (`https://app.yoyos.lat/mcp` in production), and acts as the OAuth authorization server for it. Each tool call resolves its token to the same user access and tenant context that cookies and mobile JWTs produce, checks that the store's connection is still active, applies the per-store limit, reads through the orders or products feature and returns a projection that masks customer data.

Code: `apps/core/src/features/assistants/` (connections, access resolution, OAuth hooks, projection, MCP routes and tools), cross-feature wiring in `apps/core/src/composition/assistant-server.ts` and `assistant-tools.ts`, Better Auth configuration in `apps/core/src/shared/infrastructure/auth.ts`, shared JWKS cache in `src/shared/infrastructure/jwks-cache.ts`, fixed-window limiter in `src/shared/infrastructure/fixed-window-limiter.ts`, readiness and dispatch queue in `apps/core/src/features/orders/domain/dispatch-readiness.ts`, product search and detail in `apps/core/src/features/products/application/search-for-assistant.ts` and `find-for-assistant.ts` with the budgeted read in `infrastructure/assistant-read.ts`, stock levels in `features/products/domain/stock-level.ts`, the storefront state in `catalogStorefront.describe` of `features/catalog`, product wiring in `apps/core/src/composition/assistant-product-capabilities.ts`, sales tools in `features/assistants/presentation/tools/sales-tools.ts` with their period and figures rules in `features/assistants/domain/sales-period.ts` and `sales-figures.ts`, sales reads in `features/orders/infrastructure/sales-read.ts` and wiring in `apps/core/src/composition/assistant-sales-capabilities.ts`, web routes `apps/core/app/routes/assistant-authorize.tsx` and `assistant-settings.tsx`, texts under `assistants` in `apps/core/app/locales.ts`. Persistence: `AssistantConnection` and the Better Auth `oauth*` models in `apps/core/prisma/schema.prisma`. Initial values of every limit and lifetime: the `ASSISTANT_*` variables in `apps/core/.env.example`.

## Scope

- One connector address for every store; the store comes from who authorizes, never from the address. Reason: the address can be shared without exposing anything.
- Nine read-only tools: four for orders, **Buscar pedidos**, **Ver pedido**, **Pedidos por cobrar** and **Pedidos por despachar hoy**; two for products, **Buscar productos** and **Ver producto**; and three for sales, **Resumen de ventas**, **Lo más vendido** and **Productos sin ventas**. There is no tool that creates, changes, cancels, registers, approves, rejects, prices, restocks or voids anything. Reason: writes need their own confirmation design.
- Every connection reads all nine tools; there is no per-tool or per-category choice. Reason: the consent lists every category the connector reads, and a connection must hold all of them (see [Rules](#rules)).
- The «Asistentes de IA» page is web only. Reason: connecting is done once, where the agent's connector settings live, and it is not a daily operation; cutting an agent from a phone works through the same page in the phone's browser (rejected: a mobile screen and its tests for a one-time task; no page, which would leave a password reset as the only way to cut access).
- An account belongs to one store, so there is no store picker.
- Not supported: customer tools or customer rankings; stock-alert tools; margins, profit, cost of goods or inventory value (the purchase price stays only in **Ver producto**); refunds and discounts (Yoyos records neither); cash as a payment method (Yoyos has none); a breakdown of sales by day, week, source or seller; money confirmed during a period of any order; a comparison with the same period of the previous year; variants without sales inside a product that sold; finance screens in the app; creating or editing products, prices, stock or variants; a product category (Yoyos has none), margins and profit, sorting by price or stock, searching product descriptions, photos; revealing a full phone, address or document to the agent even if the owner asks; CSV export or a daily summary; a history of what an agent asked or received; a limit that survives a restart.

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
| `resumen_de_ventas` | Resumen de ventas | «¿Cómo me fue este mes?», «¿cuánto me pagaron por Yape de lo que vendí?», «¿cuál es mi ticket promedio?» |
| `lo_mas_vendido` | Lo más vendido | «¿Qué es lo que más vendí?», «¿qué talla de polo sale más?» |
| `productos_sin_ventas` | Productos sin ventas | «¿Qué no se está vendiendo?», «¿qué casaca no se vende?» |

The server instructions, shown to the agent once, say: Yoyos is the store's sales tool and this connector only reads; answer in the language the owner writes in, using only what the tools return and keeping store data unchanged (see [Language](#language)); amounts, dates and states come ready to show; wait the seconds the limit gives and never retry in a loop; to change an order, send the owner to Yoyos with the order link; customer phones and addresses are hidden on purpose and the agent must not claim it can get them; on a not-authorized refusal, ask the owner to reconnect from the agent's settings (the address is in Yoyos → Ajustes → Asistentes de IA); convey a readiness reason's meaning, in the owner's language, without turning it into a promise, and «Tiene un pago por revisar.» means reviewing that report in Yoyos, not registering a payment; compute relative ranges from the «Hoy es …» line, not from the agent's clock. The product paragraph adds: Yoyos has no product categories, so a type of product is searched by name; the purchase price is for the owner and is not offered in a text meant for a customer; never add costs up to compute margins; stock is the current count, not a reservation; mention a hidden catalog once per conversation unless the owner asks about it. The sales paragraph (at most 700 characters) spans the three sales tools: for totals, best sellers and products that do not sell use them and never add pages of orders; «Ventas» are registered orders, paid or not, and «Recibido» is what those sales have paid, confirmed whenever, not what came into the account in those dates, so past figures keep moving; the comparison comes computed and says which figure is which, so the agent does not recompute or invert it nor adjust rounded percents; amounts in different currencies are never added. Everything else lives once, in the description of the tool it concerns.

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

- Optional inputs, combinable: `texto` (up to 120 characters), `valores` (1 to 3 entries, each «Azul» or «Color: Azul», up to 30 characters per name), `precio_desde` and `precio_hasta` (up to two decimals, store currency, both ends inclusive), `stock` («con stock», «stock bajo» or «agotado»), `en_catalogo` («sí» or «no»; the tool description defines a product as in the catalog when it is visible and has at least one active variant, and the agent combines it with variant filters), `orden` («recientes», the default, or «nombre» A–Z) and `pagina`. Lists are 20 per page, with the total.
- **Text** is one phrase matched partially, ignoring case and accents, on the product name or any variant SKU (active or not). It is not split into words: «polo azul» finds only names containing «polo azul»; colors and sizes go in `valores`. Descriptions are not searched. Reason: the name and SKU search of the app list, made accent-insensitive.
- **Product types:** Yoyos has no category, so the description tells the agent to search one short singular word or stem, with the examples «polo» for «polos» and «casac» for «casacas» written literally, and to try a shorter one before saying there is none. Yoyos applies no plural or synonym rules. Reason: understanding words belongs to the model (rejected: a category field nobody can set, which would match nothing).
- **Variant filters** (`valores`, price range, `stock`) apply together to one active variant: a product matches when at least one of its active variants meets all of them. Example: with «M / Azul» at S/ 39.90 and 2 units and «L / Rojo» at S/ 45.00 and 10, `valores: ["Azul"]`, `stock: "con stock"` and `precio_hasta: 40` match through «M / Azul»; `valores: ["Rojo"]` with `precio_hasta: 40` does not. Reason: «azul en M con stock» must mean one sellable variant. Deactivated variants are never matched. `en_catalogo: "no"` includes hidden products, which can have active variants, so it combines with variant filters: it matches hidden products with a matching active variant (a product with no active variant matches no variant filter).
- **Values** match exactly on the whole name, ignoring case, accents and surrounding spaces: «azul» matches «Azul», «M» does not match «Mostaza». With «Opción: valor» the option must match too; an entry splits at its first colon only when the left side is an option of the store, so values such as «3:4» stay reachable. There are no word lists, synonyms or plural rules: the agent maps the owner's words to the store's values.
- **Unknown value or option** answers the store's vocabulary so the agent can retry in one call: every option of the store's products with its values held by an active variant, options in alphabetical order, values in the order the seller saved them taking products newest first (so «S, M, L» stays in that order), a value spelled differently across products listed once as written in the newest one, at most 100 values and «y 20 valores más» when cut. Texts: «Tu tienda no tiene el valor "Celeste". Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.», «Tu tienda no tiene el valor "M" en Color. Valores de tu tienda: …», «Tu tienda no tiene la opción "Material". Valores de tu tienda: …» and, for a store whose products have no options, «Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto.». A value held only by deactivated variants counts as unknown, because it can never match.
- A reversed price range answers «El precio hasta (S/ 20.00) es menor que el precio desde (S/ 50.00).»; a negative amount or more than two decimals is refused with the remedy.
- **Each product:** name; SKU (the variant's when it has one variant, «Varias variantes» or «Sin SKU»); price over its active variants as the app list shows it, «S/ 39.90» or «Desde S/ 39.90», or «Sin variantes activas» when it has none; stock, the total of its active variants plus the summary of their levels («Stock: 12 · 1 agotada, 1 con stock bajo», «Stock: 0 · Agotado»; no stock line and no level for a product without active variants, never «Agotado»); the catalog line, «En el catálogo» (visible with at least one active variant), «No está en el catálogo: producto oculto» (hidden with active variants), «No está en el catálogo: producto oculto y sin variantes activas» or «No está en el catálogo: sin variantes activas». The wording keeps the word «producto» so it reads apart from the store-level «Tu catálogo está oculto…» line; number of variants («6 variantes, 1 desactivada»); its Yoyos link `${BETTER_AUTH_URL}/products/<id>`; the customer link («Link para tu cliente», `https://rosa.yoyos.lat/productos/<id>`) only when the catalog is published, the product is in the catalog and the product currency is the store currency, the public catalog's own filter ([Public catalog · Rules](public-catalog.md#rules)); and, with a variant filter, the matching variants (combination, SKU, sale price, stock, level), at most 10 per product followed by «y 4 variantes más: usa Ver producto». SKUs in lists are shortened to 40 characters. Never the purchase price.
- **Every answer, empty ones included,** carries the catalog line: «Tu catálogo está publicado en https://rosa.yoyos.lat/.», «Tu catálogo está oculto: ahora nadie ve tus productos.» or «Tu catálogo está oculto y no tiene link todavía.».
- Empty answers repeat the filters applied («No hay productos con esos filtros: texto "polos", stock bajo.»); a store with no products, including when `valores` is sent, answers «Tu tienda todavía no tiene productos.».
- A page of 20 products at maximum lengths, with or without 3 matching variants each, fits the 24 KB budget; neither the page size nor the 10-variant cap shrinks silently.

### Ver producto

- Input: exactly one of `producto`, the identifier returned by **Buscar productos**, or `sku`, an exact SKU (case and surrounding spaces ignored). A SKU belongs to one variant: it opens that variant's product and marks the variant «Buscada por SKU», so the agent answers about it first.
- Returns name, description (up to 1,000 characters; a longer one ends «… (la descripción continúa en Yoyos)» so it is not presented as complete), the options with their values in saved order, the catalog line (the same four wordings as in the search), the customer link under the same condition as in the search (never for a hidden product), the total stock of the active variants with its level summary, every variant in saved order (up to the 100 a product can have) and the Yoyos link.
- Each variant: combination, SKU («Sin SKU»), sale price, purchase price («Sin precio de compra» when the seller never entered one; «S/ 0.00» only when the seller entered 0), stock, level, «Activa» or «Desactivada». SKUs and option values are shown whole.
- A product of 60 variants with a 1,000-character description at maximum ASCII lengths fits the 24 KB budget; a larger product, or the same text in two-byte characters, still answers complete, never cut and never with the reading-failure text.
- An unknown identifier, an unknown SKU and another store's product or SKU answer the same: «No encontré ese producto en tu tienda. Búscalo con Buscar productos.». A `producto` that is not an identifier answers the same without reading.

### Stock levels

«Agotado» and «stock bajo» are levels of **one active variant**, never of a product total: «Agotado» is 0 units, «Stock bajo» is 1 to 3 units, and «con stock» is 1 or more (low included). The threshold is one constant for every store, changed only by Yoyos (`lowStockThreshold` in `features/products/domain/stock-level.ts`). Reason: it fits small clothing stock without configuration (rejected: 1 to 5, which is noisier; an owner-configured threshold, which needs a settings screen).

- The `stock` filter uses these levels per variant: «stock bajo» returns products with at least one active variant at 1 to 3 units, «agotado» with at least one at 0, «con stock» with at least one above 0.
- The product line only counts its active variants at each level and says «Agotado» only when every active variant is at 0. A product with one variant shows that variant's level. Deactivated variants have no level and do not count.
- Examples: S = 0, M = 2, L = 10 → «Stock: 12 · 1 agotada, 1 con stock bajo», returned by all three filters; six sizes at 1 unit → «Stock: 6 · 6 con stock bajo», returned by «stock bajo» and «con stock» but not «agotado»; S = 0, M = 0 → «Stock: 0 · Agotado».
- **Productos sin ventas** shows current stock with these levels and does not alert; a stock-alert tool would reuse these levels and the threshold, and if the threshold changes, this filter and these summaries change with it.

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

### Sales tools

Three tools answer «¿cómo me fue este mes?», «¿qué es lo que más vendí?» and «¿qué no se está vendiendo?» with figures that match the orders and payments Yoyos shows for the period. They follow the [common rules](#common-rules), return no customer, recipient, phone or destination, and read orders, payments, items and products that the consent already lists. The agent never computes: totals, shares, comparisons and the meaning of each figure come ready.

Sales vocabulary:

- **Venta**: an order that is not cancelled, created in the period, paid or not, from any source. An unconfirmed catalog order does not exist. Reason: the same rule as «Por cobrar» and **Pedidos por cobrar**, and owed exists only if unpaid orders are sales (rejected: only orders with a confirmed payment, which makes two tools disagree on what is owed).
- **Recibido**: the confirmed payments of the period's sales, whenever they were confirmed, as of now; the word and meaning of each order's «recibido» in **Buscar pedidos**. Reported, rejected and voided payments never count. A payment confirmed on 03/11 for an order of 28/10 counts in October, so a month's figures move until its orders are paid. It is not what came into the account in those dates: Yoyos knows when the seller confirmed a payment, not when the money arrived. Reason: it is the only definition under which sales, received and owed reconcile (rejected: payments confirmed during the period, which splits an order paid across two months; both as two figures, one more the agent can confuse).
- **Por cobrar de estas ventas**: the balance of the period's sales that are not fully paid, by the same balance rule as **Pedidos por cobrar**; never the store's whole debt, which is that tool's figure. **Exceso recibido**: the overpayments, shown only above zero. Ventas = Recibido + Por cobrar − Exceso recibido always holds.
- **Envíos**: the delivery charge the buyer pays, never the internal delivery cost, which no sales tool reads. **Ticket promedio**: sales divided by orders, rounded to the cent half up.
- Sales are in the order's creation date in America/Lima, the date the «Ventas» list and **Buscar pedidos** filter by: an order created on 31/10 at 23:30 Lima belongs to October although it is 1 November in UTC. Yoyos has no time zone per store, so America/Lima serves every store.
- Sales and products amounts are the price agreed in each order: the mentioned price never counts and Yoyos has no discounts. Delivery counts in «Ventas» and «envíos», never in a product.
- Sales are grouped by the variant sold and shown with the product's current name and the variant's current combination («M / Azul»); renaming a product does not split its sales, and deactivated variants keep theirs.
- Amounts in different currencies are never added. A store whose orders all use the store currency sees one set of figures.
- Every figure is computed at the moment of the call, for the current and the previous period alike; nothing is stored or frozen at the end of a month.

#### Period inputs (all three tools)

| Aspect | Behavior |
| --- | --- |
| Inputs | `desde` and `hasta`, both optional, `AAAA-MM-DD`, whole inclusive days in America/Lima. The description calls them the order's creation date, the same date as `creado_desde` and `creado_hasta` in **Buscar pedidos**, never the dispatch, delivery or payment date. |
| Default | Without both: from the 1st of the current month to today. With only `desde`: up to today. Only `hasta` is refused: «Indica también la fecha inicial (desde).» Reason: without a start the period and its comparison are ambiguous. |
| Future end | A `hasta` after today is read up to today and the answer says so: «Del 01/10/2026 al 20/10/2026 (hasta hoy)»; every figure, the previous period included, is computed on the period read. A `desde` after today is refused: «La fecha inicial (2026-11-05) es posterior a hoy (2026-10-31).» Refusals echo dates as `AAAA-MM-DD`, the input format. |
| Reversed | «La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).» |
| Length | At most 366 days (`salesPeriodMaxDays`): «El periodo puede tener hasta 366 días. Pide uno más corto.» Reason: a whole year, leap years included, is the longest period an owner names. The value is lowered, with the text following it, only if a period-bound statement at the maximum period cannot be read within its budget (see [Sales reads](#sales-reads)). |
| Format | Any other format is refused with the remedy. |

Previous period, computed on the period read, in this order: (1) whole calendar months compare with the same number of months just before; (2) a period that starts on the 1st and ends before the last day of its final month is moved back by the number of calendar months it touches, keeping the day numbers and cutting the end to that month's last day; (3) any other period compares with the same number of days just before. A case-2 previous period can leave a gap between the two windows (called on 20/10 without dates, 21/09–30/09 belongs to neither); the gap is never read.

| Period read | Previous period | Case |
| --- | --- | --- |
| 01/10/2026–31/10/2026 | 01/09/2026–30/09/2026, «septiembre de 2026» | 1 |
| 01/07/2026–30/09/2026 | 01/04/2026–30/06/2026 | 1 |
| 01/10/2026–20/10/2026 | 01/09/2026–20/09/2026 | 2 |
| 01/09/2026–20/10/2026 | 01/07/2026–20/08/2026 | 2 |
| 01/03/2026–30/03/2026 | 01/02/2026–28/02/2026 | 2 |
| 01/10/2026–07/10/2026 | 01/09/2026–07/09/2026, not 24/09–30/09 | 2 |
| 11/10/2026–17/10/2026 | 04/10/2026–10/10/2026 | 3 |
| 15/09/2026–14/10/2026 | 16/08/2026–14/09/2026 | 3 |

#### Resumen de ventas

- Input: the period. Every answer carries the period read and the previous period with its dates. Every answer with sales carries one meaning line: «Ventas son los pedidos registrados en estas fechas, pagados o no. Recibido son los pagos confirmados de esas ventas, aunque se confirmaran después: no es lo que entró a tu cuenta en estas fechas. Por cobrar es lo que aún deben estas ventas, no todo lo que te deben.»
- Figures: «Ventas» split into «productos» (item subtotals) and «envíos»; «Pedidos»; «Ticket promedio» (not shown with zero orders); «Recibido»; «Por cobrar de estas ventas»; «Exceso recibido».
- «Por medio de pago»: received by method, largest first (ties by name A–Z), with its share of «Recibido» rounded half up to the whole percent, or «menos de 1%» below 0.5%: «Yape», «Plin», «Transferencia bancaria», «Billetera digital sin especificar» for a wallet payment recorded without provider (other countries show the wallets of their catalog). The summary refines by provider the method that **Ver pedido** shows as «Billetera digital»: a «Yape» line and a «Billetera digital» payment are the same payment, and the description says so. A method without confirmed payments is not listed. Shares are rounded one by one and may add up to 99% or 101%; the agent is told not to adjust them.
- With sales but no confirmed payment: «Recibido: S/ 0.00» and «Todavía no hay pagos confirmados de estas ventas.» instead of the breakdown.
- «Pagos por revisar»: «3 pagos reportados por revisar, en 2 pedidos. Se aprueban o rechazan en Yoyos.» (singular «1 pago reportado por revisar, en 1 pedido. Se aprueba o rechaza en Yoyos.»), for buyer reports on the period's sales; it counts reports and the orders that hold them. Reports carry no amount and count nowhere until approved. A report on a cancelled order is not counted: it can no longer be reviewed.
- «Cancelados»: «3 pedidos cancelados (S/ 240.00) no cuentan en las ventas.» Cancelled orders are out of sales, orders, ticket, received, owed, best sellers and products without sales; an order cancelled after the period also leaves the period it was created in.
- Money on cancelled orders: «En pedidos cancelados hay S/ 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.», only while the cancelled orders of the period hold confirmed payments, which never count in «Recibido». The remedy names the web because voiding a payment on a cancelled order is offered only there ([Orders · Payments](orders.md#payments)). Reason: the sale does not exist, but since Yoyos records no refund the owner must learn of money held (rejected: silence, which hides it; counting it in «Recibido», which breaks the reconciliation). A currency with no sales in either period but cancelled orders holding confirmed money gets one line after the last block, «En pedidos cancelados en USD hay USD 40.00 en pagos confirmados. …», with no block, no count and no other figure; it is not repeated when the empty-period answer already carries each currency's cancelled lines.
- Next steps live in the description: the unpaid orders behind «Por cobrar» are listed with **Buscar pedidos**, `pago: «por cobrar»` and `creado_desde`/`creado_hasta` set to the period read; every unpaid order of the store with **Pedidos por cobrar**; the orders with a report to review, paid or not, with **Buscar pedidos** and the same dates without `pago`, where they show «Pago por revisar».
- Comparison with the previous period: a header with its dates, plus the month's name when it is exactly one calendar month («Comparado con el periodo anterior (septiembre de 2026, del 01/09/2026 al 30/09/2026):»), then one line each for sales, orders, ticket and received. Each line names both figures and the direction in words so it cannot be read backwards: «Ventas: S/ 680.00 en este periodo y S/ 600.00 en el anterior: S/ 80.00 más que en el anterior (+13%).», «… : igual que en el anterior.». The difference is this period minus the previous one; the percent is relative to the previous figure, rounded half up on the magnitude to the whole number with the sign of the difference (−14.5% → −15%); a non-zero difference that rounds to 0 shows «(menos de 1%)»; a previous figure of 0 shows the difference without percent. The ticket comparison uses the two rounded averages so the shown figures and the difference reconcile. Received by method and owed are not compared. With no sales in the previous period: «Sin ventas en el periodo anterior (del 01/09/2026 al 30/09/2026).» and no lines. Reason for words over a signed number: a signed difference under a «previous period» header can be read backwards.
- Open period: when the period read ends today, the received line adds «Este periodo sigue abierto: su recibido puede subir mientras se pagan sus ventas.», because the previous period has had more time to be paid.
- Empty period: «No hay ventas del 01/10/2026 al 31/10/2026.», then the cancelled lines and the previous period's figures alone, with no differences («En el periodo anterior (…): ventas S/ 600.00, 3 pedidos, ticket promedio S/ 200.00, recibido S/ 500.00.» or «Tampoco hubo ventas en el periodo anterior (…).»). A store with no orders at all: «Tu tienda todavía no tiene pedidos.», alone.
- Another currency: one complete block per currency with sales in the period or the previous one, the store currency first and then the others by code A–Z, each with its own comparison; the meaning line, the payments-to-review count and «Hoy es …» appear once. A block whose currency has no sales in the period opens with «No hay ventas en PEN del 01/10/2026 al 31/10/2026.» and shows its previous figures alone; «No hay ventas del …» without a currency is said only when no currency has sales. Amounts in a currency other than PEN render with the shared formatter, for example «USD 40.00».

#### Lo más vendido

- Inputs: the period, `orden` («unidades», the default, or «monto»), `texto`, `producto`, `pagina`.
- One line per product sold: current name, units, amount (item subtotals, delivery excluded), share, the product identifier and the Yoyos link. Under it, its variants sold with their current combination, units and amount, most units first (ties by amount, then combination A–Z), at most 3 followed by «y 4 variantes más: pide este producto para verlas todas» («y 1 variante más: …»). A product without options shows no variant line. Variants never carry a share.
- Share: every product share, in every mode, is of the period's whole product amount in the store currency, never of the filtered products, and says so: «44% de tus ventas de productos del periodo». Reason: a filtered share of 100% would be read as the whole store's sales.
- Order: by units (ties by amount, then name A–Z) or by amount (ties by units, then name A–Z); 20 products per page with the total and «hay más: pide la página 2». Reason for 20 × 3: the shape **Buscar productos** already proves within the 24 KB budget at maximum lengths.
- Header: «Del 01/10/2026 al 31/10/2026: 11 unidades de 2 productos, S/ 640.00 en productos.» Counters take the singular for one in every text of the three tools.
- `texto`: one phrase matched as in **Buscar productos** (partial, ignoring case and accents, on the product name or any variant SKU), up to 120 characters; ranking and header cover only the matching products and the header names both the filter and the denominator («… 8 unidades de 1 producto, S/ 280.00 de los S/ 640.00 que vendiste en productos.»). The description repeats the singular-stem advice of **Buscar productos**.
- `producto`: the identifier returned by this tool or by **Buscar productos**; it answers that product alone with every variant sold, no cap, so «¿qué talla de polo sale más?» is answered complete. `texto`, `orden` and `pagina` are ignored with it, the description says so, and the answer adds «Con producto se ignoran texto, orden y pagina.» when any was sent. A product with no sales: «"Polo básico" no tuvo ventas del 01/10/2026 al 31/10/2026.». An unknown identifier, or another store's product: «No encontré ese producto en tu tienda. Búscalo con Buscar productos.»
- Currency: the ranking, amounts and shares cover only the store currency; each other currency adds one line («Además vendiste en USD: 1 pedido, 3 unidades, USD 90.00 en productos, fuera de este ranking.»). With `texto` or `producto` the line names units and amount without an order count («Además vendiste "Polo básico" en USD: 3 unidades, USD 90.00, fuera de estas cifras.»). Reason: the order count of matching products cannot be summed from per-variant totals and other currencies are rare.
- Empty: «No vendiste productos del 01/10/2026 al 31/10/2026.»; with sales only in another currency «No vendiste productos en PEN …» followed by the other-currency lines; with `texto` «Ningún producto que coincida con "casac" se vendió …». A page beyond the last: «Esa página no existe: hay 14 productos en total, 20 por página.»

#### Productos sin ventas

- Inputs: the period, `texto`, `pagina`.
- Products that existed by the end of the period, with at least one active variant and total stock of active variants above 0 today, that have no unit in the period's sales. A product created after the period is never listed. A unit sold in any currency counts as a sale; cancelled orders and unconfirmed catalog orders are never a sale.
- Each product: name, current stock with its level summary as **Buscar productos** shows it, identifier and Yoyos link, and «Última venta antes del periodo: 14/08/2026» or «Ninguna venta antes del periodo»; «Volvió a venderse el 15/10/2026» (the first sale after the period) only when the period ended before today and there is one; «Creado el 25/10/2026» when it was created inside the period. These dates are exact for every checked product, however old.
- Header: «3 de tus 5 productos con stock no se vendieron del 01/10/2026 al 31/10/2026.» The checked products are the ones existing by the end of the period with an active variant and stock above 0 today; with `texto`, «… de tus 2 productos con stock que coinciden con "casac" …».
- Order: most stock first, then oldest last sale before the period (none first), then name A–Z; 20 per page with the total. Stock is the current count, not the stock at the start of the period, and the answer says it once: «El stock es el de hoy.».
- Short periods: under 14 days the answer adds «Este periodo tiene solo 3 días: para ver lo que no rota, pide al menos un mes.». When the owner names no period, the description tells the agent to send the last 30 days including today, counted from the «Hoy es …» line, instead of the default month to date. Reason: on the 2nd of the month almost every product is «sin ventas».
- Empty answers, checked in this order, so «all sold» is said only when something was checked: a store without products («Tu tienda todavía no tiene productos.»); `texto` matching no product («Ningún producto coincide con "casac".»); no product with stock today («Ninguno de tus productos tiene stock hoy, así que no hay productos parados que revisar.»); products with stock but all created after the period («Tus productos con stock se crearon después del 30/09/2026: ninguno estaba a la venta en esas fechas.»); every product checked sold («Tus 5 productos con stock tuvieron ventas del 01/10/2026 al 31/10/2026.»). A page beyond the last answers the page text.

#### Sales reads

- Each call takes a sales slot and runs every read in one RepeatableRead snapshot with its own fixed budget (1 s to get a connection, 10 s for the transaction, 1.5 s per statement, JIT off, at most 6 statements), the same for every sales tool. The paths issue 4 statements (summary), 5 (best sellers, with or without `producto`) and 4 (products without sales); the overhead is 2 statements (the tenant and timeout `set_config`, and `jit` off), 3 with the storefront currency read, as for product reads. Every path keeps at least one statement of margin, and a unit test pins `maxStatements × statementTimeoutMs + maxWait ≤ timeout` for the product and the sales budgets, so the statement limit fires before the transaction timer.
- At most 2 sales reads are in flight per process, separate from the 3 product slots; a call waits up to 2,000 ms for a slot (before any transaction, holding no connection) and then answers the sales reading-failure text. Reason: a sales read can hold a connection up to 10 s, so sharing slots would make a slow summary fail product searches that have a tighter budget, one slot would make an agent calling the summary and the ranking in parallel fail its second call. Consequence: sales reads (≤ 10 s) and product reads (≤ 5 s) can hold 5 of the 10 pool connections, so the web app, the order tools and the per-call pipeline keep 5, not 7.
- The orders feature owns every read that decides what a sale is (not cancelled, visible, created in the period) and every money figure; the products feature owns product identity, current names, combinations, the text match and stock. Orders returns variant ids and the composition joins them in memory with the product data; `features/assistants` imports neither feature. One shared fragment defines the visible-order rule and another the balance, used by the sales reads and by **Pedidos por cobrar**, so «Por cobrar de estas ventas» and that tool cannot drift.
- Sums are computed in SQL and returned as integer cents; percents and the average ticket are computed in integer cents with half-up rounding of the magnitude and the sign reapplied; no floating-point division decides a rounded figure. «Productos» in the summary is the sum of each order's items total and agrees with the best sellers' header, which sums the item subtotals.
- Every statement is bounded by the windows it reads (the period, plus the previous period for the summary, each at most 366 days, never the gap) or by the catalog (3,000 products and 12,000 variants at the expected maximum); none depends on the store's whole history. Period-bound joins (the payments and the items of the window's orders) are driven by the window's order ids, so their cost follows the window and not the store's payment or item history.
- Period filters compare `createdAt` with untyped or `timestamp` bounds, never `timestamptz`: those operators are not leakproof and under the forced RLS policy would lose the index.
- Too many orders: «Este periodo tiene demasiados pedidos para leerlo de una vez. Pide uno más corto, por ejemplo un mes.» is answered when a statement times out in a step whose cost grows with the period and the period read has more than 31 days. Every other failure (a catalog-bound step, a transaction timeout, an unavailable database, a period of 31 days or fewer over budget, a busy slot) answers the sales reading-failure text. Reason: a month is the shortest period worth asking for and its failure is most likely load, which passes, while repeating a longer period would fail the same way. **Productos sin ventas** has no period-bound step and never answers the too-many text.
- Cost rule, judged by cost and not by plan shape (at 366 days the summary reads half of four years of orders and a sequential scan with a hash join is the right plan; forcing plans is not done): on a history of four years at the expected maximum volume (60,000 orders a year, 2 items and 1.2 payments per order, plus the same volume in 20 other companies, with `VACUUM (ANALYZE)` after seeding), every statement at the maximum period in the worst shape of its tool (a case-2 period of 13 touched months for the summary; the worst unsold page of 80 stale variants) runs within half its statement budget, the statements that exist for short periods are not slower on four years of history than on one (within 1.5 times plus 50 ms), and the item-dates statement for 12,000 variants stays within a page bound. Cold runs of 366 days are judged by the buffers they touch, because their milliseconds follow the host's disk cache, which shared hosts do not hold steady; repeated runs are judged by milliseconds. The only plan assertion is that windows of 31 days or fewer, read as the application role under the forced RLS policy, use the created-date index. The opt-in load checks (`SALES_LOAD=1`) record, for each statement, the first and the repeated run and the buffers read, so the margin can be transferred to the production database (whose `random_page_cost` and memory decide how far the cold run costs).

#### Sales persistence

- `Order_companyId_createdAt_id_key`, a unique index on `Order (companyId, createdAt, id)`, serves the period reads, the created-date filter and the newest-first sort of **Buscar pedidos**, and is the target of the item date foreign key. Without a created-date index a short period would scan the store's whole order history. At long periods PostgreSQL rightly prefers a sequential scan; the index is for the short windows that are the common case.
- `OrderItem.orderCreatedAt` copies the order's `createdAt` onto each item and is guaranteed by a composite foreign key `(companyId, orderCreatedAt, orderId)` → `Order (companyId, createdAt, id)` with `ON UPDATE CASCADE ON DELETE RESTRICT`. See [Orders · Item sale date](orders.md#item-sale-date). With `OrderItem (companyId, variantId, orderCreatedAt, orderId)` it gives the exact last sale before and first sale after a period for every variant by index-only `LIMIT 1` probes whose cost depends on the catalog, not on the variant's history. It replaces `OrderItem (companyId, variantId)`, its prefix, which is dropped; the product foreign key and the ordered-variants lookup use the new index.
- `Payment_companyId_orderId_covering_idx` on `Payment (companyId, orderId)` including `status`, `amount`, `method` and `walletProvider` makes the window's payment lookups index-only, so their cost does not depend on the heap pages of the store's payment history. Prisma cannot express `INCLUDE`: `schema.prisma` declares an `@@index` over the six columns mapped to that name, and a no-change `prisma migrate dev --create-only` must emit nothing.
- The concurrent index builds and the index drop follow the dispatch queue index precedent, each alone in its file: a build resets `lock_timeout` and `statement_timeout` first and carries a recovery comment; the `DROP INDEX CONCURRENTLY` file is a single statement without `RESET`. `IF NOT EXISTS` silently keeps an INVALID index left by a failed build, so the checks read `pg_index.indisvalid`.
- Backfills filter by company explicitly although the migration role bypasses RLS: under the forced policy without `app.company_id` an `UPDATE` would silently touch no row, so the filter is for correctness, not for access. Between the migration that adds the nullable column and the one that links it, an old-version insert succeeds with a null date and the link migration repeats the idempotent backfill under its lock before `SET NOT NULL`; after the link migration and before the new app is deployed, an old-version insert fails on the new column.

## Rules

| Aspect | Behavior |
| --- | --- |
| Read only | A tool call records only its connection's «Último uso» and its log line. Every tool module declares `access: "read"` and its tools carry the read-only annotations; the validator refuses anything else. |
| Store isolation | A connection reads only the store that authorized it; another store's order number, product, SKU, option value or link answers as nonexistent. |
| Current data | Every call reads orders, products, prices and stock as they are now; nothing is copied for the agent. Stock is the current count, not a reservation. |
| Consent scope | A connection reads only what its consent listed, and must hold every current data scope (`orders:read` and `products:read`); every authorization grants all of them. A scope literal and a consent line are added only when a tool reads data the consent does not list; a new group of tools over listed data requires the current scopes it reads and adds none, as the sales tools do (they require both, and no connection is ended for them). A connection missing any current scope is hidden from «Asistentes de IA» and ended lazily as `consent_outdated`: its next call is refused as not authorized and its row and grant are deleted, and the agent starts authorization again on the normal screen, now listing the new category. A later new category of data therefore ends older connections instead of being granted silently or offered as a partial reauthorization. Reason: the owner consented to what the screen listed, and re-adding a connector registers a new client, so a partial reauthorization state could not be reached (rejected: granting silently, which breaks the consent; a rule limited to the newest scope, which would leave older connections without the new tools and without ever showing their consent). |
| Who can authorize | Any signed-in, verified account with a store. There are no roles; the connection belongs to the store and records which account authorized it. Any account of the store can disconnect any of its connections. |
| Product data | The store's own data, not customer data: no masking applies to product names, descriptions or SKUs. Exact stock and SKUs are sent. The purchase price is the owner's commercial data: only **Ver producto**, listed in the consent, never in a search list, which an owner may paste into a customer chat. QR identifiers, photos and internal ids other than the product links are never sent. Reason: the agent acts for the owner, who sees stock in the app; the public catalog's rule against exposing quantities protects the store from buyers, not from its owner. |
| Masking | In every response of every tool: phone only as its last 3 digits, no street, no reference, no identity document. Names are shown with long digit runs masked (see [Masking](#masking)). The owner cannot turn masking off. Reason: data in a third-party agent's history cannot be recalled. |
| Store limit | 60 tool calls per minute per store, shared by all its connections and by order, product and sales tools, in fixed one-minute windows. Discovering tools and connecting do not count. A refused call changes nothing else. Other stores are not affected. Reason: one agent in a loop must not degrade Yoyos for every other store. |
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
| Reading failed | Each module has its own text: «No pudimos leer tus pedidos en este momento. Inténtalo de nuevo en unos segundos.» for orders, «No pudimos leer tus productos en este momento. Inténtalo de nuevo en unos segundos.» for products and «No pudimos leer tus ventas en este momento. Inténtalo de nuevo en unos segundos.» for sales; never an empty list or an empty summary |
| Product read slower than its budget, or too many product reads at once | The products reading-failure text |
| Sales read slower than its budget, or no sales slot within 2,000 ms | The sales reading-failure text |
| Period of more than 31 days with a period-bound read over its budget | «Este periodo tiene demasiados pedidos para leerlo de una vez. Pide uno más corto, por ejemplo un mes.» |
| Invalid period (only `hasta`, `desde` after today, reversed, longer than 366 days), or an unknown `producto` | The field and the remedy ([Period inputs](#period-inputs-all-three-tools)); nothing is read |
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

Sales tools call the composed operations `orders.readSalesForAssistant`, `orders.summarizeSales`, `orders.summarizeSoldVariants` and `orders.findVariantSaleDates`, and `products.describeVariantsForAssistant` and `products.listStockedForAssistant`, joined only in `src/composition/assistant-sales-capabilities.ts` and its two tool-specific files (see [Sales reads](#sales-reads)). The budgeted snapshot is generic and lives in `src/shared/infrastructure/budgeted-snapshot.ts`; products and sales each pass their own budget and log their own failure event, and the read slots (`src/composition/assistant-read-slots.ts`) take their wait as a parameter.

Each product call runs in one RepeatableRead snapshot together with the storefront read, so the page, the total, the vocabulary and the catalog line never disagree with a concurrent save. The snapshot has fixed constants, not environment variables: 1 s to get a connection, 5 s for the transaction, 350 ms per statement and JIT off, for at most 11 statements (a search needs at most 7, a detail by SKU at most 11; the count does not grow with the number of products or variants), and a unit test pins `maxStatements × statementTimeoutMs + maxWait ≤ timeout`. At most 3 product reads are in flight per process, shared by every store; a 4th call waits up to 300 ms for a slot and then answers the products reading-failure text. Reason: product calls hold at most 3 of the 10 pool connections, so the web app and the order tools always keep 7. A statement over its limit or an exhausted pool answers the reading-failure text, never an empty list.

Product queries filter by company explicitly and use the existing indexes that lead with `companyId`; no index was added. The accent-insensitive text match, the value vocabulary and the SKU lookup cost grows with the store's own products and variants, never with other companies'. Above roughly 12,000 products in one store an all-filters search can exceed its statement limit and answers the reading-failure text. The SKU lookup is not served by the SKU expression index under row-level security (`lower` and `btrim` are not leakproof), so it scans the store's variants; it stays small. Value matching normalizes in TypeScript (one normalizer: accents and combining marks removed, lower case, trimmed) and SQL filters by the written spellings with plain equality.

The search filters stay internal to `features/products`; `shared/contracts/products.ts` and the app list do not change. Reason: no second application consumes them yet, and the app list's «sold out» is a product-level rule while the assistant's «agotado» is variant-level.

### Adding tools

Tools are grouped in `ToolModule`s, one per data category or group of tools, each with the scopes it reads (`scopes`, at least one), `access: "read"`, a paragraph of server instructions and its tools; `src/composition/assistant-tools.ts` lists them. Each module also carries its own reading-failure text, which the registry uses for an output that fails its schema and for a failed read. The registry offers a module and its instructions paragraph only to a connection that holds every scope of the module. A new category of data adds a module file in `features/assistants/presentation/tools/`, a scope literal in `domain/scopes.ts`, its consent lines in `app/locales.ts` and one entry in `assistant-tools.ts`; it never edits the server, the transport, the limiter or another module. Adding the literal to `assistantScopes` also ends older connections that lack it (see [Rules](#rules)). A group of tools over data the consent already lists (new data, not a new tool group, is what adds a scope) adds a module that declares the scopes it reads and no literal: the sales module declares `orders:read` and `products:read`. Reason: no access widens, so nothing justifies ending every connection. A write tool needs its own design: the registry refuses any module that is not read-only.

The static validator, `src/composition/assistant-tools.test.ts` (in `test:unit`, alone with `pnpm --dir apps/core mcp:validate`), connects an MCP client to the in-process server and checks every tool: ASCII name, Spanish title and description, strict input schema, read-only annotations, no write action in names, sample outputs valid against their schema, free of the fixture phone, street and document, within the 24 KB budget, and free of any instruction, title or description that tells the agent to answer in Spanish or to quote a text «tal cual».

## Observability

Events follow [Logging](logging.md). Never logged: tool inputs and outputs, searched numbers, search text, dates sent, values, SKUs, prices, amounts, counts of sales, currencies, product names, the store subdomain, customer data, the declared agent name, tokens, codes or signed queries. `oauthClientId` is a public identifier.

| Event | Level | Meaning |
| --- | --- | --- |
| `assistant_tool_called` | info | One per tool call: company, connection, tool, outcome (`answered`, `empty`, `rate_limited`, `invalid_input`, `not_found`, `failure`), duration. It is how use of the connector is measured, including how often **Resumen de ventas** is asked. A too-many-orders answer is a `failure`. |
| `assistant_access_refused` | info | A `/mcp` request refused, with its reason (`missing_token`, `invalid_token`, `request_limit`, `not_ready`, `no_connection`, `inactive`, `password_changed`, `consent_outdated`, `scope`) |
| `assistant_authorization_answered` | info | Allowed, denied, invalid or expired |
| `assistant_connection_created`, `assistant_connection_ended` | info | Connection lifecycle; created with its outcome (`inserted` or `reactivated`), ended with its reason (including `consent_outdated`) |
| `assistant_prior_grant_revoked` | info | The screen guarantee revoked a prior grant (consents and tokens) |
| `assistant_client_scopes_aligned` | info | A registered client's stored scopes were set to the current set, written only when they differed |
| `assistant_consent_refused` | warn | A consent call outside the owner's action |
| `assistant_grant_revocation_failed`, `assistant_connection_touch_failed` | warn | Cleanup or «Último uso» write failed; the operation still succeeded |
| `dispatch_queue_too_large` | warn | The dispatch queue passed its ceiling |
| `assistant_product_reads_busy` | warn | A product call found no free read slot after its 300 ms wait |
| `assistant_sales_reads_busy` | warn | A sales call found no free read slot after its 2,000 ms wait |
| `sales_read_failed` | error | A budgeted sales read failed, once per call, with the operation (`summary`, `best_sellers` or `unsold`), the step in progress, the error code, the number of days read and the answer chosen (`too_many_orders` or `read_failure`); never the dates, amounts or names |
| `product_search_failed` | error | A budgeted product read failed, with its operation (`search` or `detail`) and error code (`PERSISTENCE_UNAVAILABLE`, `STATEMENT_TIMEOUT` or `TRANSACTION_TIMEOUT`) |
| `assistant_authorize_hook_failed`, `assistant_authorization_failed`, `assistant_password_reset_cleanup_failed`, `assistant_tool_failed` | error | Unexpected failures |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Owner (any account of the store) | Connector address; connected agents with name, domain and dates | Authorize, deny, disconnect; ask their agent for any period up to 366 days | See what an agent asked; grant orders without products or the reverse; change or void anything through the agent |
| Connected agent | The store's orders, masked, and its products through the nine tools: options, values, variants, SKUs, sale prices, stock and levels, active or deactivated, catalog presence, catalog and customer links, and the purchase price of each variant in **Ver producto**; sales figures, received by method, product units and amounts, and current stock of products without sales | Read | Write anything; read another store; get a full phone, address or document; see customers in the sales tools; get margins or costs; get photos or QR codes |
| Someone with the connector address | Nothing | Start an authorization, which requires a Yoyos sign-in | Read any data |

## Known risks

- Never-used dynamic clients and expired plugin token rows are not cleaned up: with open registration and hourly rotation the global `oauthClient` and token tables grow without bound (about 2 000 refresh-token rows per connection in 90 days).
- Margins have no tool: the agent sees one variant's purchase price in **Ver producto** and the instructions tell it not to add costs up.
- No server guard keeps a product's currency equal to the store's. Such a product shows «En el catálogo» without a customer link, as the public catalog would not list it.
- The three product read slots are shared by every store the process serves, so one store's burst can make another store's product call wait up to 300 ms and then answer the reading-failure text. The two sales slots are shared the same way: two heavy summaries of one store make another store's sales call wait up to 2 s and then answer the sales reading-failure text. A cap of one in-flight sales read per company is not applied; `assistant_sales_reads_busy` shows when one store starves the others.
- Abandoned chat orders inflate «Ventas» and lower «Ticket promedio»: an order created from WhatsApp messages stays active until the seller cancels it, paid or not. The meaning line and the instructions say «Ventas» are registered orders, paid or not, and «Por cobrar» shows the gap.
- An owner who refunds outside Yoyos without voiding the payment sees «Recibido» overstated; on cancelled orders the money line asks them to void it on the web, on active orders nothing warns.
- «Recibido» differs from the wallet apps by date, and a month's figures are not final: they move while its orders are paid, voided or cancelled. While a period is open its received figure compares low against the previous period; the open-period line says so.
- A store outside Peru sees an evening sale in its own country on the next Lima day when the two zones differ.
- Sellers cannot add stock by hand ([Orders](orders.md)): a product restocked physically but still at 0 in Yoyos never appears in **Productos sin ventas**, because only products with stock today are checked.
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
- «¿Cómo me fue este mes?» (the period read with its dates, sales, received by method, owed and the comparison with the previous period, figures unchanged).
- «¿Qué es lo que más vendí?», «¿qué talla de polo sale más?» and «¿qué no se está vendiendo?» (best sellers with their variants, one product with every variant, and products with stock that sold nothing).
- «Cancela el pedido 1001» (the agent says it cannot and gives the Yoyos link).
- In «Asistentes de IA», «Último uso» changed; tap **Desconectar** and ask again (the agent asks to reconnect, and the Yoyos screen appears again).

**Check the server without an agent (MCP Inspector)**

1. Run `npx @modelcontextprotocol/inspector` and open the URL it prints.
2. Transport «Streamable HTTP», the connector address, connection type «Via Proxy»; **Auth Settings** → **Quick OAuth Flow**, sign in and allow (the screen says «Volverá a una aplicación de este equipo»).
3. **Connect** → **Tools** → **List Tools**: exactly the nine tools, all read-only. Run each with an empty input or a real order number or product identifier.

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
| A connection must hold every current data scope | Older connections never keep working without the new tools or hide a consent the owner never saw |
| A scope is added for new data, not for a new group of tools; a module declares `scopes` | The sales tools aggregate data the consent already lists, so nothing widens and no connection is ended; the registry offers a module only to a connection holding every one of its scopes |
| Product search has no category filter; the agent searches product types by name | Yoyos has no category; a field nobody can set would match nothing |
| A hidden product is outside the catalog and `en_catalogo: "no"` combines with variant filters | A hidden product can have active variants, so the old refusal («los productos que no están en el catálogo no tienen ninguna») is no longer true; the assistants are read-only, so there is no tool to hide a product |
| Variant filters apply together to one active variant; value matching is exact without word lists | «Azul en M con stock» must mean one sellable variant; understanding words belongs to the model |
| Stock levels belong to one active variant; product lines only count them | One meaning of «stock bajo» for the filter, the product line and later stock alerts |
| Purchase price only in **Ver producto** | Owner's commercial data, asked directly and listed in the consent; lists may be pasted to customers |
| The agent answers in the owner's language; tool texts stay in Spanish | Yoyos stores no language per store or owner |
| Ventas are every order not cancelled and created in the period, paid or not | The same rule as «Por cobrar», so two tools never disagree on what is owed; the abandoned-chat risk is stated in the meaning line |
| «Recibido» is the confirmed payments of the period's sales whenever confirmed, and the answer says it is not what reached the account | It is the only definition under which sales, received and owed reconcile; Yoyos knows when the seller confirmed, not when the money arrived |
| Confirmed payments on cancelled orders stay out of «Recibido» and get their own line with the web remedy, also for a currency without sales (a line, not a block) | The sale does not exist, and since Yoyos records no refund the owner must learn of money held; a currency without sales has no block |
| Ranking and products without sales are by product with variants inside; one `producto` answers every variant | Owners speak of products; the variant breakdown answers sizes |
| Comparison lines name both figures and the direction in words; product shares are always of the period's whole product amount | A signed difference can be read backwards, and a share of filtered products reads as the share of the store's sales |
| Amounts in different currencies are never added; the summary answers one block per currency and best sellers rank the store currency only | A sum of soles and dollars is wrong |
| No margins or costs in any sales tool | The purchase price stays only in **Ver producto** |
| `OrderItem.orderCreatedAt` is guaranteed by a composite foreign key, not by convention or triggers | Two tools decide «sold in the period» from two columns, and one divergent row would put a product in both answers; a convention depends on every writer and triggers are a mechanism the repository has none of |
| `Productos sin ventas` gets exact sale dates from the item date index | The product order (most stock first, oldest last sale, none first) is met exactly at a cost bounded by the catalog (rejected: a look-back window, which contradicts what the page shows; reading only the page's variants, which cost about a second for a stale page) |
| Sales reads have 2 slots and their own 10 s budget, separate from product reads | A slow summary must not fail product searches; two month-end owners or an agent asking for the summary and ranking in parallel must still be answered; the pool reserve drops from 7 to 5 |
| Too many orders is answered only for a period-bound timeout over 31 days; everything else answers the reading-failure text | Repeating a longer period would fail the same way, while a shorter period's failure is most likely load |
| The period maximum is 366 days, lowered only if a period-bound statement fails the cost rule | A whole year is the longest period an owner names |
| A period-bound join is driven by the window's order ids, and the cost rule is judged by cost and buffers, not by plan shape | The cost follows the window and not the store's history, and forcing plans would hide a real regression; a short window must not be slower on four years than on one |
| Payment lookups use a covering index | Index-only probes make the cost independent of the heap pages of the payment history |
| The other-currency line with `texto` or `producto` names units and amount, without an order count | The count of matching products cannot be summed from per-variant totals, and other currencies are rare |
| Reading-failure text per module | A product failure must not tell the owner their orders failed |
| Product reads in one budgeted snapshot with at most 3 in flight | A slow query or a burst must not exhaust the pool shared with the web app and order tools |
| Better Auth's OAuth provider, not a custom server | The protocol is the plugin's; Yoyos adds only the hooks that tie it to connections |
| The connection row, not token lifetime, decides access | Disconnect, inactivity and password reset take effect on the next call whatever tokens the agent holds |
| Stateless MCP handler without streams | Every call is an independent read; nothing is lost on deploy |
