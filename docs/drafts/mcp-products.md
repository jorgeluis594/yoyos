# Products in AI assistants: product definition

**Status:** definition ready to implement; the questions were answered by the review gate and the founder confirms them in the pull request (see [Questions decided by the review gate](#questions-decided-by-the-review-gate)). Extends the read-only MCP server of MCP 1/4 ([AI assistants](../assistants.md), merged in #311) with a products category, and fixes the language the agent answers in. Products as they exist today: [Products](../products.md); catalog visibility: [Public catalog](../public-catalog.md). Todoist task 6hrqGV59mx8H4p7V (MCP 2/4), 31/10/2026.

**Deviation from the Todoist task:** the task lists the filters «categoría» and «publicado o no en el catálogo». Yoyos has no product category, so no category filter is delivered: the agent is told that categories do not exist and searches a product type by name. Yoyos has no per-product publish switch, so «publicado» is delivered as «en el catálogo»: the product has at least one active variant, plus the store-level line saying whether the catalog is published or hidden.

## Problem and situation

An owner who already connected their agent to Yoyos asks it «¿Qué polos azules en talla M me quedan?» while a customer waits in WhatsApp, or at night «¿Qué se me está acabando?» and «¿Cuánto me costó la casaca negra?». Today the agent can only read orders, so it answers that it cannot see products, and the owner opens the Yoyos product list, which searches only by name or SKU and filters only «with stock / sold out»: finding every blue M variant means opening each product and scanning its variants table. An owner who writes in Portuguese gets the answer in Spanish, because every text the connector sends tells the agent to answer in Spanish.

## Goal

The owner asks their agent about their products in their own words and gets the right products and variants, with price, stock and whether they are in the catalog, filtered by text, variant value, price range, stock level and catalog presence, alone or combined, plus a link to send the customer. The agent answers in the language the owner writes in.

Hypothesis: if it works, owners with a connection use product tools at least as often as order tools; it shows in `assistant_tool_called` per tool.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Owner answering a customer in the chat | Know at once whether a color and size is in stock, at what price, and send the product link | Their own agent (ChatGPT, Claude, other MCP client) |
| Owner reviewing the shop at night | See what is running out, what is not in the catalog, what sits in a price range | Their own agent |
| Owner connecting the agent | Know that the agent will read orders and products | Yoyos web authorization screen and «Asistentes de IA» (existing) |

## First-version scope

- Two read-only tools in business language: **Buscar productos** (`buscar_productos`) and **Ver producto** (`ver_producto`).
- Filters of **Buscar productos**, each optional and combinable: text, variant values, price range, stock level, catalog presence; ordered and paginated.
- A new data category «productos» in the consent. Every connection reads orders and products together. Connections authorized before this task are ended when it ships, and the owner connects again (see [Existing connections](#existing-connections)).
- Language: the server instructions and tool descriptions tell the agent to answer in the owner's language, for every tool, orders included.
- Store isolation, read-only, the 60-calls-per-minute store limit, «Último uso» and connection life are those of MCP 1/4, unchanged.
- Meeting point with MCP 4/4 (stock alerts): see [Stock levels](#stock-levels).
- Meeting point with MCP 3/4 and 4/4 adding categories: see [Existing connections](#existing-connections).
- Meeting point with the seller app: the product list may later offer the same filters with the same meaning; this task changes no screen of web or mobile beyond the consent and settings texts listed in [Screens](#screens).

## Out of this version

- Creating or editing products, prices, stock or variants from the agent: when write tools have their own confirmation design.
- A product category: Yoyos has none. When the founder asks for categories as a seller feature (field and UI on web and mobile).
- Searching the description: the text search matches name and SKU, like the app list. When the app list searches descriptions.
- Margins and profit per product or period: **no task owns them**. MCP 3/4 covers sales, collected and owed amounts, payment methods, average ticket, best sellers and products that do not rotate, without costs. The agent sees the purchase price of one variant in **Ver producto** and could be tempted to compute margins from it; the instructions tell it not to add up costs. Flagged as a deferred risk: the founder decides whether margins get a task.
- Stock alerts and orders waiting for stock: MCP 4/4. Finances and best sellers: MCP 3/4.
- A low-stock threshold the owner configures: MCP 4/4 owns the threshold and may propose it.
- Sorting by price or by stock: when owners ask for it; the price range and the stock filter cover the usual questions.
- Photos: the agent receives no photo or photo link.
- Translating tool texts per store: the agent translates (see [Language](#language)); Yoyos stores no language per store.

## Flow

1. The owner asks «¿Tienes polos azules en M?».
2. The agent calls **Buscar productos** with `texto: "polo"`, `valores: ["Azul", "M"]`.
3. Yoyos answers the products with an active variant that has both values, each with the matching variants («M / Azul», S/ 39.90, stock 2, «Stock bajo»), the catalog line, the customer link of each product in the catalog and the page line.
4. The agent answers in the owner's language and, if the owner wants, gives the customer link. If the owner asks for detail, it calls **Ver producto** with the product returned and shows every variant.

Alternative paths:

- **Unknown value:** the store has no value «Celeste». The answer lists the store's options with their values («Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L»), so the agent retries with «Azul claro» or asks the owner which one they mean.
- **Product type:** the owner asks «¿qué polos tengo?». The agent searches `texto: "polo"` (one short singular word); with no result it tries a shorter stem before saying there is none. If the owner asks for a category, the agent says Yoyos has no categories and searches by name.
- **Connection authorized before this task:** its next call gets the not-authorized answer; the agent starts authorization again by itself (or the owner connects again from the agent), and the owner sees the normal authorization screen, now listing products.
- **Change request:** the owner asks to change a price; the agent says it cannot and gives the product's Yoyos link.

## Existing connections

| Aspect | Behavior |
| --- | --- |
| What happens | Every connection authorized before this task (orders only) is ended when this task ships, like a disconnect: the row leaves «Asistentes de IA» and its tokens and consent are revoked. Decided by the coordinator (see [Questions decided by the review gate](#questions-decided-by-the-review-gate)). |
| The agent | Its next call gets the existing not-authorized answer. ChatGPT and Claude then start authorization again; what the agent shows meanwhile is its own. |
| The owner | Sees the normal authorization screen, which now lists products, and taps **Permitir acceso**; a new row appears in «Asistentes de IA». There is no «Nuevo permiso» state, no partial connection and no second row next to an old one. |
| «Asistentes de IA» | Follows the existing ended-connection behavior: the ended rows are simply no longer listed; a store whose only connection was ended sees «Todavía no conectaste ningún asistente.» and the steps open again. The line «Los asistentes se desconectan solos…» is unchanged. |
| Why | There are no customers or production data yet (repository memory; product guide rule 8.7), the consent rule of MCP 1/4 (a new category is never granted silently) is kept, and ending the connection is the only path every MCP client can follow. |
| Later categories | MCP 3/4 and 4/4 face the same choice when they add a category. This task adds none for 4/4: variant stock is already part of «productos». |

## Screens

No new screen. The existing screens of MCP 1/4 change only these texts. The accessibility rules of those screens are unchanged (each list keeps its heading and is a real list).

| Place | Spanish | Portuguese |
| --- | --- | --- |
| Authorization title | «ChatGPT quiere leer los pedidos y productos de Tienda Rosa» | «ChatGPT quer ler os pedidos e produtos de Tienda Rosa» |
| Authorization title, unnamed agent | «Un asistente quiere leer los pedidos y productos de Tienda Rosa» | «Um assistente quer ler os pedidos e produtos de Tienda Rosa» |
| «Podrá ver», new line after the order lines | «Tus productos: variantes, precios de venta, stock y si están en tu catálogo» | «Seus produtos: variantes, preços de venda, estoque e se estão no seu catálogo» |
| «Podrá ver», new line | «El precio de compra de tus variantes» | «O preço de compra das suas variantes» |
| «Nunca podrá», first line | «Crear, cambiar ni cancelar nada, ni cambiar precios o stock» | «Criar, alterar nem cancelar nada, nem mudar preços ou estoque» |
| «Asistentes de IA» intro | «Conecta ChatGPT, Claude u otro asistente para preguntarle por tus pedidos y productos. Solo puede leer: no crea, cambia ni cancela nada.» | «Conecte o ChatGPT, o Claude ou outro assistente para perguntar sobre seus pedidos e produtos. Ele só pode ler: não cria, altera nem cancela nada.» |
| **Desconectar** description | «Dejará de ver tus pedidos y productos hasta que lo conectes de nuevo.» | «Ele deixará de ver seus pedidos e produtos até você conectá-lo novamente.» |

## Tools

Both tools follow the common rules of [AI assistants · Tools](../assistants.md#common-rules) (store, amounts, lists of 20 with total and «hay más: pide la página 2», Spanish snake-case fields, invalid input with the field and the remedy, reading-failure text, never an empty list on failure).

### Buscar productos

Optional inputs:

| Input | Accepts | Meaning |
| --- | --- | --- |
| `texto` | Up to 120 characters | One phrase matched partially, ignoring case and accents, on the product name or any variant SKU, like the app list |
| `valores` | 1 to 3 entries, each «Azul» or «Color: Azul», up to 30 characters per name | Each value must be held by the same active variant; with «Opción: valor» the option name must match too |
| `precio_desde`, `precio_hasta` | Amounts with up to two decimals, in the store currency | Sale price of the active variant, both ends inclusive |
| `stock` | «con stock», «stock bajo», «agotado» | Stock level of the active variant (see [Stock levels](#stock-levels)) |
| `en_catalogo` | «sí», «no» | Whether the product is in the catalog (at least one active variant) |
| `orden` | «recientes» (default), «nombre» | Newest created first, or by name A–Z |
| `pagina` | 1 or more | Page of 20 |

- **Text and product types:** the description tells the agent that Yoyos has no categories; to find a type of product it searches one short word in singular or its stem («polo», «casac»), and with no result tries a shorter one before telling the owner nothing exists. `texto` is matched as one phrase, not as separate words: «polo azul» finds only names containing «polo azul»; colors and sizes go in `valores`. No plural or synonym rules are applied by Yoyos.
- **Variant filters** (`valores`, price range, `stock`) apply together to one variant: a product matches when at least one of its active variants meets all of them. Example: «Polo básico» has «M / Azul» at S/ 39.90 with 2 units and «L / Rojo» at S/ 45.00 with 10; `valores: ["Azul"]` with `stock: "con stock"` and `precio_hasta: 40` matches through «M / Azul»; `valores: ["Rojo"]` with `precio_hasta: 40` does not match.
- Variant filters look only at active variants, because a deactivated variant is not sold anywhere. `en_catalogo: "no"` together with a variant filter is refused: «Los filtros de variante (valores, precio y stock) solo miran variantes activas, y los productos que no están en el catálogo no tienen ninguna. Quita esos filtros o en_catalogo.».
- **Value matching** is exact on the whole name, ignoring case, accents and surrounding spaces: «azul» matches «Azul», «M» does not match «Mostaza». No word lists, synonyms or plural rules: the agent maps the owner's words to the store's values.
- **Unknown value or option:** the answer lets the agent discover the store's values in one call. It lists every option name of the store's products with its values, grouped by option name, in alphabetical order, at most 100 values in total with «y 20 valores más» when cut:
  - unknown value: «Tu tienda no tiene el valor "Celeste". Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.»;
  - value that exists only under another option: «Tu tienda no tiene el valor "M" en Color. Valores de tu tienda: Color: Azul, Negro, Rojo · Talla: S, M, L.»;
  - unknown option: «Tu tienda no tiene la opción "Material". Valores de tu tienda: Color: …»;
  - store whose products have no options: «Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto.».
- `precio_hasta` lower than `precio_desde` answers «El precio hasta (S/ 20.00) es menor que el precio desde (S/ 50.00).». A negative amount or more than two decimals is refused with the remedy.
- **Each product:**
  - name;
  - SKU: the variant's SKU when it has one variant, «Varias variantes» or «Sin SKU»; a product without active variants shows its SKU the same way over all its variants;
  - price over its active variants, as the app list: «S/ 39.90» or «Desde S/ 39.90»; a product without active variants shows «Sin variantes activas» instead of a price;
  - stock: total of its active variants and the summary of its variant levels (see [Stock levels](#stock-levels)): «Stock: 12 · 1 agotada, 1 con stock bajo», «Stock: 0 · Agotado», «Stock: 6 · 6 con stock bajo»;
  - catalog: «En el catálogo» or «No está en el catálogo: sin variantes activas»;
  - number of variants («6 variantes, 1 desactivada»);
  - Yoyos link `${BETTER_AUTH_URL}/products/<id>`;
  - customer link `https://rosa.yoyos.lat/productos/<id>` («Link para tu cliente»), only when the catalog is published and the product is in the catalog;
  - with a variant filter, the matching variants (combination, SKU, sale price, stock, level), at most 10 per product, then «y 4 variantes más: usa Ver producto».
- Never the purchase price.
- **Every answer, empty ones included,** carries the catalog line: «Tu catálogo está publicado en https://rosa.yoyos.lat/.», «Tu catálogo está oculto: ahora nadie ve tus productos.» or «Tu catálogo está oculto y no tiene link todavía.». The instructions tell the agent to mention a hidden catalog once per conversation unless the owner asks about the catalog.
- **Empty answers** say which filters were applied: «No hay productos con esos filtros: texto "polos", stock bajo.»; a store with no products: «Tu tienda todavía no tiene productos.».

### Ver producto

- Input: exactly one of `producto`, the product identifier returned by **Buscar productos**, or `sku`, an exact SKU (case and surrounding spaces ignored). A SKU belongs to one variant: it opens that variant's product and marks the variant «Buscada por SKU», so the agent answers about it first.
- Returns name, description, the options with their values in saved order, the catalog line, «En el catálogo» or not, the customer link under the same condition as in the search, every variant in saved order, the total stock of the active variants with its level summary, and the Yoyos link.
- **Description:** up to 1,000 characters; a longer one is cut and ends «… (la descripción continúa en Yoyos)», so the agent does not present it as complete.
- **Each variant:** combination, SKU («Sin SKU»), sale price, purchase price («Sin precio de compra» when the seller never entered one; S/ 0.00 only when the seller entered 0), stock, stock level, «Activa» or «Desactivada».
- Every variant is listed, up to the 100 a product can have. The response budget of MCP 1/4 (24 KB) is met by a product of 60 variants with a 1,000-character description and every field at its maximum length; the static validator checks that case; a larger product still answers complete, never cut and never with the reading-failure text, as a large order does in MCP 1/4.
- The instructions tell the agent that the purchase price is for the owner and must not be offered in a text meant for a customer, and not to compute margins.
- An unknown identifier, an unknown SKU and another store's product or SKU answer the same: «No encontré ese producto en tu tienda. Búscalo con Buscar productos.».

## Rules

| Aspect | Behavior |
| --- | --- |
| Read only | No product tool creates, edits, prices, restocks, activates or deactivates anything. To change a product the agent gives its Yoyos link. |
| Store | Always the authorized store; another store's product behaves as nonexistent. |
| Current data | Every call reads products, prices and stock as they are now; nothing is copied for the agent. The description says stock is the current count, not a reservation. |
| «En el catálogo» | A product is in the catalog when it has at least one active variant, the rule of the public catalog; there is no per-product publish switch. Whether the catalog itself is published or hidden is the store's, stated in every answer. A product with stock 0 is still in the catalog, shown there as «Agotado». |
| Category | There is none; the agent is told so and searches by name. |
| Prices | Sale price per variant, in the store currency, formatted as the web: «S/ 39.90». Purchase price only in **Ver producto**. |
| Store limit | Product calls count toward the 60 calls per minute per store shared with order tools. |
| Pagination | 20 products per page, newest first by default; the total counts products, not variants. |

### Stock levels

«Agotado» and «stock bajo» are levels of **one active variant**, never of a product total:

| Level | Stock of the active variant | Shown |
| --- | --- | --- |
| Agotado | 0 | «Agotado» |
| Stock bajo | 1 to 3 units | «Stock bajo» |
| Con stock | 1 or more (includes stock bajo) | nothing extra |

- The threshold 1 to 3 is the same for every store and adjustable only by Yoyos.
- The `stock` filter uses these levels per variant: `stock: "stock bajo"` returns products with at least one active variant at 1 to 3 units; `stock: "agotado"`, with at least one at 0; `stock: "con stock"`, with at least one above 0.
- The product line only summarizes its variants and never applies the threshold to a sum: it counts its active variants at each level («1 agotada, 1 con stock bajo») and says «Agotado» only when every active variant is at 0, the app's and catalog's meaning. A product with one variant shows that variant's level («Stock bajo»). Deactivated variants have no level and do not count.
- Examples: S = 0, M = 2, L = 10 → «Stock: 12 · 1 agotada, 1 con stock bajo», returned by `stock: "agotado"`, `"stock bajo"` and `"con stock"`; six sizes at 1 unit → «Stock: 6 · 6 con stock bajo», returned by `"stock bajo"` and `"con stock"`, not by `"agotado"`; S = 0, M = 0 → «Stock: 0 · Agotado».
- **Meeting point with MCP 4/4:** 4/4 owns the threshold and uses these same levels. If 4/4 changes the value or makes it configurable, this filter and these summaries change with it. 4/4's tool adds what **Buscar productos** does not give: one list of variants across products, most urgent first and not grouped by product, and the paid orders waiting for stock with which variant and how much is missing.

## Language

- The server instructions say: answer in the language the owner writes in (for example Spanish or Portuguese); tool texts come in Spanish and are translated when answering, without changing product names, combinations, values, SKUs, links, amounts, dates or order numbers, which are the store's data.
- The MCP 1/4 instruction «cítalo tal cual» for readiness reasons becomes «transmite su sentido sin convertirlo en una promesa, en el idioma del dueño».
- No server instruction, tool description or tool message says to always answer in Spanish.
- Tool names, input values («stock bajo», «por cobrar») and messages stay in Spanish for every store: they are read by the agent, not by the owner. Reason: Yoyos stores no language per store or owner, and the agent knows the owner's language from the conversation.
- The consent screens and «Asistentes de IA» keep following the interface language (Spanish or Portuguese), as today.

## When something fails

| Situation | What the agent receives | What it can do |
| --- | --- | --- |
| Products found | The page with the catalog line | Answer |
| No match | «No hay productos con esos filtros: …» with the filters applied, and the catalog line | Widen the filters, try a shorter word |
| Store without products | «Tu tienda todavía no tiene productos.» and the catalog line | Tell the owner |
| Unknown value or option, store without options | The message with the store's values, or the no-options text | Retry with a store value or ask the owner |
| Invalid input (reversed price range, more than 3 values, variant filter with `en_catalogo: "no"`) | The field and the remedy | Correct and retry |
| Unknown product or SKU | «No encontré ese producto en tu tienda. Búscalo con Buscar productos.» | Search first |
| Connection authorized before this task | The existing not-authorized answer (the connection was ended) | Start authorization again; the owner allows on the normal screen |
| Store limit | The MCP 1/4 text with the seconds to wait | Wait, never loop |
| Reading failed | «No pudimos leer tus productos en este momento. Inténtalo de nuevo en unos segundos.», never an empty list | Retry later |

A read has no doubtful outcome with effect: repeating a call is always safe.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Connected agent | The store's orders as in MCP 1/4 and its products: options, values, variants, SKUs, sale prices, stock and levels, active or deactivated, catalog presence, catalog and customer links; the purchase price of each variant in **Ver producto** | Read | Write; see another store; get photos, QR codes or internal codes other than the product links |
| Owner | The consent with the product lines | Authorize, deny, disconnect | Grant orders without products or the reverse: a connection reads every category it listed |

- Product data is the store's own data, not customer data: no masking applies to names, descriptions or SKUs. Customer masking of MCP 1/4 is unchanged.
- The purchase price is the owner's own commercial data, asked for directly and listed in the consent; it is kept out of search lists, which an owner may paste into a customer chat.
- QR identifiers are never sent. Reason: they are what labels print and what photo lookups read; the agent has no use for them.
- Exact stock is sent. Reason: the agent acts for the owner, who sees it in the app; the public-catalog rule against exposing quantities protects the store from buyers, not from its owner.

## Information that is kept

Nothing new. The connection records its granted categories as today; product reads copy nothing and leave no history. Ending the connections authorized before this task deletes them as any ended connection.

## Vocabulary

- **En el catálogo:** the product has at least one active variant, so the catalog offers it when published. Used the same in the consent («si están en tu catálogo») and the tools. Not the same as **catálogo publicado**, the store's switch.
- **Activa / Desactivada:** the status of a variant, as in the app. A product is in the catalog when at least one of its variants is active.
- **Stock bajo:** an active variant with 1 to 3 units; **agotado:** an active variant with 0. A product is «Agotado» only when every active variant is.
- **Valor:** a value of a product option («Azul» of «Color»), as the seller typed it.
- **Link para tu cliente:** the public catalog page of a product; the Yoyos link is the owner's admin page.

## Closed decisions

| Decision | Why |
| --- | --- |
| No category filter; the agent searches product types by name | Yoyos has no category; a field nobody can set would match nothing |
| No per-product publish flag; «en el catálogo» means at least one active variant | Founder decision of 16/10/2026; the catalog shows every active product |
| Stock levels belong to one active variant; product lines only count them | One meaning of «stock bajo» for the filter, the product line and MCP 4/4 |
| Variant filters apply together to one active variant | «Azul en M con stock» must mean one sellable variant |
| Exact value matching without word lists | Founder rule of 28/10/2026: understanding words belongs to the model |
| Stock belongs to the products category | MCP 4/4 then needs no further authorization for variant stock |
| Connections authorized before this task are ended; owners connect again | No production stores; keeps the MCP 1/4 consent rule with a path every client follows |
| Purchase price only in **Ver producto**, with its own text when missing | Owner's commercial data, asked directly, listed in the consent; lists may be pasted to customers |
| The agent answers in the owner's language; tool texts stay in Spanish | Founder decision of 31/10/2026 on #311; no language is stored per store |

## Acceptance criteria

Store used unless stated: «Polo básico» (M / Azul S/ 39.90 stock 2; L / Rojo S/ 45.00 stock 10), «Casaca» (M / Azul S/ 120.00 stock 0), catalog published at rosa.yoyos.lat.

1. `valores: ["azul", "m"]` returns both products with their «M / Azul» variant; adding `stock: "con stock"` returns only «Polo básico», its «M / Azul» marked «Stock bajo».
2. `precio_desde: 40`, `precio_hasta: 130` returns «Polo básico» through «L / Rojo» and «Casaca» through «M / Azul»; `precio_hasta: 30` returns «No hay productos con esos filtros: precio hasta S/ 30.00.» with the catalog line.
3. `stock: "agotado"` returns «Casaca» with «M / Azul» stock 0 and the line «Stock: 0 · Agotado»; «Polo básico» is not returned.
4. A product «Jean» with S = 0, M = 2, L = 10 shows «Stock: 12 · 1 agotada, 1 con stock bajo» and is returned by `stock: "agotado"`, `"stock bajo"` and `"con stock"`; a product «Vestido» with six sizes at 1 unit shows «Stock: 6 · 6 con stock bajo» and is returned by `"stock bajo"` but not `"agotado"`; a product without options with 2 units shows «Stock bajo».
5. A product whose variants are all deactivated is returned by `en_catalogo: "no"` with «Sin variantes activas» instead of a price, «No está en el catálogo: sin variantes activas» and no customer link, and not by `en_catalogo: "sí"`; `en_catalogo: "no"` with `stock: "agotado"` is refused with the variant-filter message.
6. `texto: "polo"` combined with `valores: ["Rojo"]`, `stock: "con stock"`, `precio_hasta: 50` and `en_catalogo: "sí"` returns «Polo básico» only, with «L / Rojo».
7. With 45 matching products, page 1 has 20, the total 45 and «hay más: pide la página 2»; page 3 has 5 and no more line.
8. `valores: ["Celeste"]` in a store whose colors are Azul, Azul claro, Negro and Rojo and sizes S, M, L answers «Tu tienda no tiene el valor "Celeste". Valores de tu tienda: Color: Azul, Azul claro, Negro, Rojo · Talla: S, M, L.»; in a store with 130 values the list stops at 100 with «y 30 valores más».
9. `valores: ["Color: M"]` answers «Tu tienda no tiene el valor "M" en Color. …» even though a talla «M» exists; `valores: ["Material: Algodón"]` answers the unknown-option text with the store's values; in a store whose products have no options, any `valores` answers «Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto.».
10. Category: the description of **Buscar productos** says Yoyos has no categories and how to search a product type; with a product «Polos oversize» added, `texto: "polo"` returns «Polo básico» and «Polos oversize», and `texto: "polos"` returns only «Polos oversize». Manual check: asked «¿qué categorías tengo?», the agent says Yoyos has no categories and offers to search by name.
11. A product with 14 variants matching `valores: ["M"]` lists 10 of them and «y 4 variantes más: usa Ver producto».
12. Search results never contain a purchase price; each product in the catalog carries «Link para tu cliente» `https://rosa.yoyos.lat/productos/<id>`. With the catalog hidden, no customer link is returned and every answer, empty ones included, carries «Tu catálogo está oculto: ahora nadie ve tus productos.».
13. In a store with no products, any search answers «Tu tienda todavía no tiene productos.» with the catalog line.
14. **Ver producto** with `sku: "pol-m-az "`, where «M / Azul» has SKU «POL-M-AZ», opens «Polo básico» with that variant marked «Buscada por SKU»; with the identifier or SKU of another store's product, or an unknown SKU, it answers «No encontré ese producto en tu tienda. Búscalo con Buscar productos.».
15. **Ver producto** of a product with a 1,500-character description returns the first 1,000 followed by «… (la descripción continúa en Yoyos)».
16. **Ver producto** shows «Sin precio de compra» for a variant whose purchase price was never entered and «S/ 0.00» for one entered as 0.
17. **Ver producto** of a product with 100 variants lists all of them in saved order, with deactivated ones marked «Desactivada», never a QR or a photo; with 60 variants, a 1,000-character description and every field at maximum length the answer is within 24 KB; with 100 such variants it answers complete.
18. A connection authorized before this task is not listed in «Asistentes de IA» after release; its next call gets the not-authorized answer; authorizing again shows the normal screen with the product lines and creates one row whose agent lists six tools.
19. The authorization screen, «Asistentes de IA» intro and **Desconectar** description show the Spanish texts of [Screens](#screens) under `/es-PE/…` and the Portuguese ones under `/pt-BR/…`.
20. The 61st call in one minute across order and product tools of one store is refused with the store-limit text; another store's calls are unaffected.
21. Language, verifiable: the server instructions contain the rule to answer in the owner's language and to keep store data unchanged; no server instruction, tool description or message of any module says to answer in Spanish or «tal cual» for readiness reasons. Manual check: an owner writing «Quais camisetas azuis eu tenho?» gets the answer in Portuguese with product names, values and «S/ 39.90» unchanged; asked «O que eu despacho hoje?», gets the order answer in Portuguese, with a readiness reason such as «Se requiere al menos un pago para despachar.» rendered with the same meaning in Portuguese; an owner writing in Spanish gets Spanish.
22. No product tool changes a product, price or stock: after any sequence of calls the products are identical.

## Questions decided by the review gate

Answered on 31/10/2026 by the review gate of the implement-task skill (UX/UI and product reviewers agreeing, consolidated by the coordinator). The founder confirms them in the pull request.

| Question | Answer | Decided by | Reason | Discarded |
| --- | --- | --- | --- | --- |
| 1. Yoyos has no product category: how does the agent answer «¿qué polos tengo?» | (1) No category; the description says categories do not exist and how to search a product type by name | Reviewers | The data does not exist; works for stores that name products by type | (2) a free-text category set from the product form in another task: field, UI on both platforms and the seller's work; (3) the field without UI: a filter that matches nothing |
| 2. Does the agent see the purchase price? | (1) Yes, in **Ver producto** only, never in search lists, listed in the consent, with «Sin precio de compra» when missing | Reviewers | The owner's own commercial data, asked for directly and listed in the consent | (2) never: the agent cannot answer «¿cuánto me costó?» |
| 3. What is «stock bajo»? | (1) 1 to 3 units of one active variant, the same for every store, adjustable only by Yoyos; MCP 4/4 owns later changes | Reviewers | Fits small clothing stock without configuration | (2) 1 to 5: noisier; (3) owner-configured: a settings screen out of this task |
| Connections authorized before this task | Ended when this ships; the owner connects again on the normal screen | Coordinator | No customers or production data (rule 8.7); keeps the MCP 1/4 consent rule; the only path every client can follow | Reauthorization under «Nuevo permiso»: unreachable, since re-adding registers a new client and the same client with an active connection skips the screen; granting products silently: breaks the consent rule |

Deferred with real risk, for the founder to decide whether to create a Todoist task: margins have no owner task (see [Out of this version](#out-of-this-version)).

Decided unless objected:
- Two tools, **Buscar productos** and **Ver producto**, 20 products per page, newest first or by name.
- Variant filters (values, price range, stock) apply together to the same active variant; deactivated variants are never matched; combining them with `en_catalogo: "no"` is refused with a remedy.
- Values match exactly ignoring case, accents and spaces, at most 3 per call, optionally as «Opción: valor»; an unknown value or option answers with every option and value of the store, up to 100 values; a store without options says so.
- Text search covers name and SKU as one phrase, like the app list; descriptions are not searched; the agent is told to search one short singular word or stem and retry shorter.
- «Stock bajo» and «agotado» are per active variant; the product line counts its variants per level and says «Agotado» only when all are at 0.
- «En el catálogo» means at least one active variant; every answer, empty ones included, states whether the catalog is published or hidden, and the agent mentions a hidden catalog once per conversation.
- The customer link to the public product page is returned when the catalog is published and the product is in it.
- Empty answers repeat the filters applied.
- Stock is part of the products category; MCP 4/4 reuses the levels and owns the threshold.
- Connections authorized before this task are ended at release; ended rows simply leave «Asistentes de IA».
- SKU and exact stock are sent; photos, QR codes and internal ids other than the product links are not; product data is not masked.
- **Ver producto** by SKU opens the product and marks that variant; the description is cut at 1,000 characters with «(la descripción continúa en Yoyos)»; every variant is listed even above the 24 KB budget.
- The agent answers in the owner's language; tool names, inputs and messages stay in Spanish and the agent translates them, keeping store data unchanged; this applies to the order tools too.
- Consent screen and «Asistentes de IA» texts change only to name products, in Spanish and Portuguese as written in [Screens](#screens).
