# Products in AI assistants: product definition

**Status:** draft with open questions. Extends the read-only MCP server of MCP 1/4 ([AI assistants](../assistants.md), merged in #311) with a products category, and fixes the language the agent answers in. Products as they exist today: [Products](../products.md); catalog visibility: [Public catalog](../public-catalog.md). Todoist task 6hrqGV59mx8H4p7V (MCP 2/4), 31/10/2026.

## Problem and situation

An owner who already connected their agent to Yoyos asks it «¿Qué polos azules en talla M me quedan?» while a customer waits in WhatsApp, or at night «¿Qué se me está acabando?» and «¿Cuánto le puse a la casaca negra?». Today the agent can only read orders, so it answers that it cannot see products, and the owner opens the Yoyos product list, which searches only by name or SKU and filters only «with stock / sold out»: finding every blue M variant means opening each product and scanning its variants table. An owner who writes in Portuguese gets the answer in Spanish, because every text the connector sends tells the agent to answer in Spanish.

## Goal

The owner asks their agent about their products in their own words and gets the right products and variants, with price, stock and whether they are on sale, filtered by text, variant value, price range, stock level and catalog presence, alone or combined. The agent answers in the language the owner writes in.

Hypothesis: if it works, owners with a connection use product tools at least as often as order tools; it shows in `assistant_tool_called` per tool, and in fewer product list searches on the web right after a WhatsApp message (not measured in this version).

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Owner answering a customer in the chat | Know at once whether a color and size is in stock and at what price | Their own agent (ChatGPT, Claude, other MCP client) |
| Owner reviewing the shop at night | See what is running out, what is not on sale, what sits in a price range | Their own agent |
| Owner connecting or reconnecting the agent | Know that the agent will now also read products | Yoyos web authorization screen and «Asistentes de IA» (existing) |

## First-version scope

- Two read-only tools in business language: **Buscar productos** (`buscar_productos`) and **Ver producto** (`ver_producto`).
- Filters of **Buscar productos**, each optional and combinable: text, variant values, price range, stock level, catalog presence; ordered and paginated.
- A new data category «productos» in the consent: new connections get orders and products together; an existing connection gets products only after the owner authorizes again under «Nuevo permiso».
- Language: the server instructions and tool descriptions tell the agent to answer in the owner's language, for every tool, orders included.
- Store isolation, read-only, the 60-calls-per-minute store limit, «Último uso» and connection life are those of MCP 1/4, unchanged.
- Meeting point with MCP 4/4 (stock alerts): the stock levels «agotado» and «stock bajo» are defined here once (see [Rules](#rules)); 4/4 reuses them and the products category, and adds only its tool.
- Meeting point with the seller app: the product list may later offer the same filters with the same meaning; this task changes no screen of web or mobile beyond the consent texts listed in [Screens](#screens).

## Out of this version

- Creating or editing products, prices, stock or variants from the agent: when write tools have their own confirmation design.
- A product category: Yoyos has none (see question 1). The agent finds a "category" by words of the product name.
- Searching the description: the text search matches name and SKU, like the app list. When the app list searches descriptions.
- Stock alerts and orders waiting for stock: MCP 4/4. Finances, best sellers and margins: MCP 3/4.
- A low-stock threshold the owner configures: when 4/4 or usage shows one fixed value does not fit (see question 3).
- Sorting by price or by stock: when owners ask for it; the price range and the stock filter cover the usual questions.
- Photos: the agent receives no photo or photo link.
- Translating the tool texts per store: the agent translates (see [Language](#language)); a language stored per store does not exist.

## Flow

1. The owner asks «¿Tienes polos azules en M?».
2. The agent calls **Buscar productos** with `texto: "polo"`, `valores: ["Azul", "M"]`.
3. Yoyos answers the products with an active variant that has both values, each with the matching variants («M / Azul», S/ 39.90, stock 2, «Stock bajo»), the page line and whether the catalog is published.
4. The agent answers in the owner's language. If the owner asks for detail, it calls **Ver producto** with the product returned and shows every variant.

Alternative paths:

- The store has no value «Celeste»: the tool answers with the values the store does have for that word's option, and the agent asks the owner or retries with «Azul claro».
- A connection authorized before this task asks about products: the agent has no product tools; its server instructions tell it to ask the owner to connect again from the agent's settings, which shows the authorization screen with «Nuevo permiso».
- The owner asks to change a price: the agent says it cannot and gives the product's Yoyos link.

## Screens

No new screen. The existing screens of MCP 1/4 change only these texts (Spanish shown; Portuguese follows the same change):

- **Authorization screen:** title «ChatGPT quiere leer los pedidos y productos de Tienda Rosa». «Podrá ver» adds «Tus productos: variantes, precios de venta, stock y si están a la venta»; and, if question 2 keeps it, «El precio de compra de tus variantes». When the connection already exists with orders only, the product lines appear under the heading «Nuevo permiso» and the order lines under «Ya puede ver». «Nunca podrá» becomes «Crear, cambiar ni cancelar nada, ni cambiar precios o stock».
- **«Asistentes de IA»:** intro «Conecta ChatGPT, Claude u otro asistente para preguntarle por tus pedidos y productos. Solo puede leer: no crea, cambia ni cancela nada.»; disconnect description «Dejará de ver tus pedidos y productos hasta que lo conectes de nuevo.».

## Tools

Both tools follow the common rules of [AI assistants · Tools](../assistants.md#common-rules) (store, amounts, lists of 20 with total and «hay más: pide la página 2», Spanish snake-case fields, invalid input with the field and the remedy, reading-failure text, never an empty list on failure).

### Buscar productos

Optional inputs:

| Input | Accepts | Meaning |
| --- | --- | --- |
| `texto` | Up to 120 characters | Partial, case- and accent-insensitive match on the product name or any variant SKU, like the app list |
| `valores` | 1 to 3 entries, each «Azul» or «Color: Azul», up to 30 characters per name | Each value must be held by the same active variant; with «Opción: valor» the option name must match too |
| `precio_desde`, `precio_hasta` | Amounts with up to two decimals, in the store currency | Sale price of the active variant, both ends inclusive |
| `stock` | «con stock», «stock bajo», «agotado» | Stock of the active variant (see [Stock levels](#stock-levels)) |
| `en_catalogo` | «sí», «no» | Whether the product is offered by the catalog when it is published |
| `orden` | «recientes» (default), «nombre» | Newest created first, or by name A–Z |
| `pagina` | 1 or more | Page of 20 |

- **Variant filters** (`valores`, price range, `stock`) apply together to one variant: a product matches when at least one of its active variants meets all of them. Example: «Polo básico» has «M / Azul» at S/ 39.90 with 2 units and «L / Rojo» at S/ 45.00 with 10; `valores: ["Azul"]` with `stock: "con stock"` and `precio_hasta: 40` matches through «M / Azul»; `valores: ["Rojo"]` with `precio_hasta: 40` does not match.
- Variant filters look only at active variants, because a deactivated variant is not sold anywhere. `en_catalogo: "no"` together with a variant filter is refused: «Los filtros de variante (valores, precio y stock) solo miran variantes a la venta, y los productos que no están en el catálogo no tienen ninguna. Quita esos filtros o `en_catalogo`.».
- **Value matching** is exact on the whole name, ignoring case, accents and surrounding spaces: «azul» matches «Azul», «M» does not match «Mostaza». No word lists, synonyms or plural rules: the agent maps the owner's words to the store's values. A value no product of the store has answers «Tu tienda no tiene el valor "Celeste". Valores de Color: Azul, Azul claro, Negro, Rojo.», listing at most 30 values of every option that has a value starting with the same letter, or, when there is none, «Opciones de tu tienda: Color, Talla.». An unknown option in «Opción: valor» answers «Tu tienda no tiene la opción "Material". Opciones: Color, Talla.»; a value that exists only under another option answers «Tu tienda no tiene el valor "M" en Color. Valores de Color: Azul, Negro, Rojo.».
- `precio_hasta` lower than `precio_desde` answers «El precio hasta (S/ 20.00) es menor que el precio desde (S/ 50.00).». A negative amount or more than two decimals is refused with the remedy.
- Each product: name; SKU («Varias variantes», «Sin SKU»), price as the app list shows it («S/ 39.90» or «Desde S/ 39.90» over its active variants), total stock of its active variants, its stock level («Agotado», «Stock bajo» or nothing), «En el catálogo» or «No está en el catálogo: sin variantes activas», the number of variants («6 variantes, 1 desactivada»), link `${BETTER_AUTH_URL}/products/<id>`. With a variant filter, also the matching variants (combination, SKU, sale price, stock, level), at most 10 per product, then «y 4 variantes más: usa Ver producto».
- Every answer carries the catalog line: «Tu catálogo está publicado en https://rosa.yoyos.lat/.», «Tu catálogo está oculto: ahora nadie ve tus productos.» or «Tu catálogo está oculto y no tiene link todavía.».
- Empty: «No hay productos con esos filtros.»; a store with no products: «Tu tienda todavía no tiene productos.».

### Ver producto

- Input: `producto`, the product identifier returned by **Buscar productos**, or `sku`, an exact SKU (case and surrounding spaces ignored). Exactly one of them.
- Returns name, description (shortened to 1,000 characters with «…»), the options with their values in saved order, the catalog line and the product's presence in it, every variant in saved order (combination, SKU, sale price, purchase price if question 2 keeps it, stock, stock level, «Activa» or «Desactivada»), the total stock of the active variants and the link. Every variant is listed (up to 100).
- An unknown identifier, an unknown SKU and another store's product answer the same: «No encontré ese producto en tu tienda. Búscalo con Buscar productos.».

## Rules

| Aspect | Behavior |
| --- | --- |
| Read only | No product tool creates, edits, prices, restocks, activates or deactivates anything. To change a product the agent gives its Yoyos link. |
| Store | Always the authorized store; another store's product behaves as nonexistent. |
| Current data | Every call reads products, prices and stock as they are now; nothing is copied for the agent. Stock read now may change before the owner sells: the description says stock is the current count, not a reservation. |
| «En el catálogo» | A product is in the catalog when it has at least one active variant, the rule of the public catalog; there is no per-product publish switch. Whether the catalog itself is published or hidden is the store's, stated in every answer. A product with stock 0 is still in the catalog, shown there as «Agotado». |
| Category | There is none. The description tells the agent that Yoyos has no categories and that a type of product («polos», «casacas») is searched with `texto` on the name. |
| Prices | Sale price per variant, in the store currency, formatted as the web: «S/ 39.90». |
| Store limit | Product calls count toward the 60 calls per minute per store shared with order tools. |
| Pagination | 20 products per page, newest first by default; the total counts products, not variants. |

### Stock levels

One definition for this task, MCP 4/4 and any later list filter, always on an active variant:

| Level | Stock of the variant | Shown |
| --- | --- | --- |
| Agotado | 0 | «Agotado» |
| Stock bajo | 1 to 3 units (initial value, adjustable by Yoyos, the same for every store; see question 3) | «Stock bajo» |
| Con stock | 1 or more | nothing extra |

- «Stock bajo» is part of «con stock»: filtering «con stock» includes low-stock variants.
- A product is «Agotado» when all its active variants are at 0; otherwise «Stock bajo» when its total stock of active variants is 1 to 3; otherwise it shows no level. A product without active variants shows no level.
- Deactivated variants have no level and do not count in totals, as in the app.

## Language

- The server instructions say: answer in the language the owner writes in (for example Spanish or Portuguese); tool texts come in Spanish and are translated when answering, without changing product names, combinations, values, SKUs, amounts, dates or order numbers, which are the store's data.
- The MCP 1/4 instruction «cítalo tal cual» for readiness reasons becomes «transmite su sentido sin convertirlo en una promesa, en el idioma del dueño».
- Tool names, input values («stock bajo», «por cobrar») and messages stay in Spanish for every store: they are read by the agent, not by the owner. Reason: Yoyos stores no language per store or owner, and the agent already knows the owner's language from the conversation.
- The consent screens and «Asistentes de IA» keep following the interface language (Spanish or Portuguese), as today.

## When something fails

| Situation | What the agent receives | What it can do |
| --- | --- | --- |
| Products found | The page with the catalog line | Answer |
| No match | «No hay productos con esos filtros.» | Widen the filters |
| Store without products | «Tu tienda todavía no tiene productos.» | Tell the owner |
| Unknown value or option | The message with the store's values or options | Retry with a store value or ask the owner |
| Invalid input (reversed price range, more than 3 values, variant filter with `en_catalogo: "no"`) | The field and the remedy | Correct and retry |
| Unknown product or SKU | «No encontré ese producto en tu tienda. Búscalo con Buscar productos.» | Search first |
| Connection without the products category | No product tools are listed; the instructions say to reconnect | Ask the owner to connect again from the agent's settings |
| Store limit | The MCP 1/4 text with the seconds to wait | Wait, never loop |
| Reading failed | «No pudimos leer tus productos en este momento. Inténtalo de nuevo en unos segundos.», never an empty list | Retry later |

A read has no doubtful outcome with effect: repeating a call is always safe.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Connected agent with the products category | The store's products, options, values, variants, SKUs, sale prices, stock, stock levels, active or deactivated, catalog presence and catalog address; purchase price per question 2 | Read | Write; see another store; get photos, QR codes or internal codes other than the product link |
| Connected agent without it (authorized before this task) | Orders only, as today | Read orders | See products until the owner authorizes again |
| Owner | The consent with the new lines | Authorize, deny, disconnect | Grant orders without products or the reverse: a connection reads every category it listed |

- Product data is the store's own data, not customer data: no masking applies to names, descriptions or SKUs. Customer masking of MCP 1/4 is unchanged.
- QR identifiers are never sent. Reason: they are what labels print and what photo lookups read; the agent has no use for them.
- Exact stock is sent. Reason: the agent acts for the owner, who sees it in the app; the public-catalog rule against exposing quantities protects the store from buyers, not from its owner.

## Information that is kept

Nothing new. The connection records its granted categories as today; product reads copy nothing and leave no history.

## Vocabulary

- **En el catálogo:** the product has at least one active variant, so the catalog offers it when published. Not the same as **catálogo publicado**, which is the store's switch.
- **Stock bajo:** an active variant with 1 to 3 units; **agotado:** an active variant with 0.
- **Valor:** a value of a product option («Azul» of «Color»), as the seller typed it.

## Closed decisions

| Decision | Why |
| --- | --- |
| No per-product publish flag; «en el catálogo» means at least one active variant | Founder decision of 16/10/2026; the catalog shows every active product |
| Variant filters apply together to one active variant | «Azul en M con stock» must mean one sellable variant, not three different ones |
| Exact value matching without word lists | Founder rule of 28/10/2026: understanding words belongs to the model |
| One stock-level definition shared with MCP 4/4 | Two meanings of «stock bajo» in the same agent would contradict each other |
| Stock belongs to the products category | MCP 4/4 then needs no further authorization for variant stock |
| A new category needs a new authorization | Rule of MCP 1/4: the owner consented to what the screen listed |
| The agent answers in the owner's language; tool texts stay in Spanish | Founder decision of 31/10/2026 on #311; no language is stored per store |

## Acceptance criteria

1. A store has «Polo básico» (M / Azul S/ 39.90 stock 2; L / Rojo S/ 45.00 stock 10) and «Casaca» (M / Azul S/ 120.00 stock 0). `valores: ["azul", "m"]` returns both products with their «M / Azul» variant; adding `stock: "con stock"` returns only «Polo básico», its variant marked «Stock bajo».
2. Same store: `precio_desde: 40`, `precio_hasta: 130` returns «Polo básico» through «L / Rojo» and «Casaca» through «M / Azul»; `precio_hasta: 30` returns «No hay productos con esos filtros.».
3. `stock: "agotado"` returns «Casaca» with «M / Azul» stock 0 and the product marked «Agotado»; «Polo básico» is not returned.
4. A product whose variants are all deactivated is returned by `en_catalogo: "no"`, marked «No está en el catálogo: sin variantes activas», and not by `en_catalogo: "sí"`; `en_catalogo: "no"` with `stock: "agotado"` is refused with the variant-filter message.
5. `texto: "polo"` combined with `valores: ["Rojo"]`, `stock: "con stock"`, `precio_hasta: 50` and `en_catalogo: "sí"` returns «Polo básico» only, with «L / Rojo».
6. With 45 matching products, page 1 has 20, the total 45 and «hay más: pide la página 2»; page 3 has 5 and no more line.
7. `valores: ["Celeste"]` in a store whose colors are Azul, Negro and Rojo answers that the store has no value «Celeste» and lists the options of the store.
8. `valores: ["Color: M"]` matches nothing even if a talla «M» exists, and answers «Tu tienda no tiene el valor "M" en Color. Valores de Color: Azul, Negro, Rojo.».
9. **Ver producto** with the identifier of a product of another store, and with an unknown SKU, both answer «No encontré ese producto en tu tienda. …».
10. **Ver producto** of a product with 100 variants lists all of them in saved order, with deactivated ones marked, and never a QR or a photo.
11. With the catalog hidden, every **Buscar productos** answer carries «Tu catálogo está oculto: ahora nadie ve tus productos.».
12. A connection authorized with orders only lists only the four order tools; after the owner authorizes again, the screen shows the product lines under «Nuevo permiso» and the connection lists six tools.
13. The 61st call in one minute across order and product tools of one store is refused with the store-limit text; another store's calls are unaffected.
14. An owner writing «Quais camisetas azuis eu tenho?» receives the answer in Portuguese, with product names, values and «S/ 39.90» unchanged; an owner writing in Spanish receives Spanish.
15. No product tool changes a product, price or stock: after any sequence of calls the products are identical.

## Open items and questions

Questions (answer with the option number):

1. Yoyos has no product category. How does the agent answer «¿qué polos tengo?»?
   (1) No category in this task: the agent searches words of the product name, and the description says categories do not exist. Recommended: nothing to invent or fill in; works today for stores that name products by type.
   (2) Add a free-text category per product, set from the product form on web and mobile, in a separate task, and this filter waits for it. Adds a field, a UI change and the seller's work of categorizing existing products.
   (3) Add the category field now without UI. Nobody could set it, so the filter would match nothing.

2. Does the agent see the purchase price of each variant?
   (1) Yes, in **Ver producto** only, listed in the consent as «El precio de compra de tus variantes». Recommended: the owner asks «¿cuánto me costó?» and MCP 3/4 will need costs for margins; it is the owner's own data.
   (2) No, never. The agent cannot answer costs or margins; MCP 3/4 has to raise it again.

3. What is «stock bajo»?
   (1) 1 to 3 units of an active variant, the same for every store, adjustable only by Yoyos. Recommended: covers a clothing store with few units per size; MCP 4/4 reuses it without configuration.
   (2) 1 to 5 units, same rule. Flags more variants; noisier for stores with small stock.
   (3) A threshold the owner configures. Needs a settings screen (UI, out of this task) and its own task before 4/4.

Decided unless objected:
- Two tools, **Buscar productos** and **Ver producto**, 20 products per page, newest first or by name.
- Variant filters (values, price range, stock) apply together to the same active variant; deactivated variants are never matched; combining them with `en_catalogo: "no"` is refused with a remedy.
- Values match exactly ignoring case, accents and spaces, at most 3 per call, optionally as «Opción: valor»; an unknown value answers with the store's values or options.
- Text search covers name and SKU, like the app list; descriptions are not searched.
- «En el catálogo» means at least one active variant; every answer states whether the catalog is published or hidden.
- Stock is part of the products category; MCP 4/4 reuses it and the stock levels defined here.
- Existing connections get products only after authorizing again under «Nuevo permiso»; a connection cannot hold orders without products.
- SKU and exact stock are sent; photos, QR codes and internal ids other than the product link are not; product data is not masked.
- The agent answers in the owner's language; tool names, inputs and messages stay in Spanish and the agent translates them, keeping store data unchanged; this applies to the order tools too.
- Consent screen and «Asistentes de IA» texts change only to name products, in Spanish and Portuguese.
- Description shortened to 1,000 characters in **Ver producto**; at most 10 matching variants per product in **Buscar productos**.
