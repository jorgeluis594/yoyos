# Sales and best sellers in the AI assistant: product definition

**Status:** definition ready to implement once the review gate approves round 2; the four round-1 questions were decided by the review gate and await the founder's confirmation in the pull request. Builds on the merged MCP 1/4 (orders) and 2/4 (products), documented in [AI assistants](../assistants.md), whose conventions apply unchanged unless this document says otherwise. Reads [Orders](../orders.md) and [Products](../products.md) as they work today; there is no sales summary or product ranking anywhere in Yoyos. Todoist task 6hrqGV5xvQFxGWQV («MCP 3/4: finanzas por periodo y lo más vendido en el MCP»), 31/10/2026.

## Problem and situation

On the last night of the month the owner of Tienda Rosa wants to know how October went. Today the connected agent can only list orders twenty at a time, and its instructions tell it that there are no sales totals, so it says so; if it tried, it would add pages by hand, mix cancelled orders, count a rejected receipt as money and miss the orders created after 19:00 Lima, which are already 1 November in UTC. Without the agent the owner scrolls the «Ventas» list, opens the Yape and Plin apps, adds in a notebook what each sale paid by each method and still does not know whether September was better, which polo sold the most or which casaca has been sitting on the shelf all month.

## Goal

The owner asks their agent «¿cómo me fue este mes?», «¿cuánto me pagaron por Yape de lo que vendí?», «¿qué es lo que más vendí?», «¿qué talla de polo sale más?» or «¿qué no se está vendiendo?» and gets figures that match the orders and payments Yoyos shows for that period, with the comparison against the previous period already computed and with the meaning of each figure stated so the agent cannot present it as something else.

Hypothesis: if it works, owners ask for the summary at least once a week; it would show as **Resumen de ventas** calls in `assistant_tool_called`, from more than one store, in the first month.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Owner closing the month at night, from the phone or the computer | Sales, what those sales have paid and still owe, by method, against the previous period | Their own agent, through the Yoyos connector |
| Owner deciding what to restock or put on offer | What sold most, which sizes of one product sell, and what did not move | Their own agent |
| Connected agent | Ready figures, their meaning and the next tool to use, without computing anything | The three new tools |

There is no new screen in the Yoyos web or mobile app, and the authorization screen does not change.

## First-version scope

- Three new read-only tools: **Resumen de ventas**, **Lo más vendido** and **Productos sin ventas**, added to the six of MCP 1/4 and 2/4.
- One period per call, given as whole days of order creation in America/Lima; by default the current month up to today.
- Summary: sales split into products and delivery charges, number of orders, average ticket, received, owed, overpaid, received by payment method, payments awaiting review, cancelled orders left out with the confirmed money they hold, and the previous period with the difference.
- Best sellers by product, with the variants that sold, ordered by units or by amount; narrowed by a phrase, or one product with every variant sold.
- Products with stock that sold nothing in the period, narrowed by a phrase when asked.
- The server instructions stop saying that there are no sales totals and tell the agent how to read these figures (see [Server instructions](#server-instructions)).
- Meeting point with MCP 4/4 (stock alerts and orders waiting for stock): **Productos sin ventas** shows current stock with the variant levels of [AI assistants · Stock levels](../assistants.md#stock-levels) and does not alert; alerts belong to 4/4, which only adds its own tool.

## Out of this version

- Finance screens in the app, CSV export, an automatic daily or monthly summary (task scope).
- Breakdown inside a period by day, week, source (catálogo, WhatsApp, venta manual) or seller. Trigger: owners asking «¿qué día vendí más?» in the call logs.
- Money confirmed during a period, of any order («¿cuánto entró esta semana?»). Yoyos records when the seller confirmed a payment, not when it reached the account, so even this figure would not match the bank. Trigger: owners comparing «Recibido» with their wallet and asking for the date view (see [Questions decided by the review gate](#questions-decided-by-the-review-gate), question 1).
- Comparison with the same period of the previous year. The previous period is always the one just before. Trigger: owners asking «¿y el año pasado?» after a summary.
- Margins, profit, cost of goods or inventory value at cost. The purchase price stays only in **Ver producto** and the agent never adds costs up ([AI assistants · Decisions](../assistants.md#decisions)).
- Variants without sales inside a product that did sell (sizes that do not move). Trigger: owners asking for it after the product-level version.
- Customer rankings («¿quién me compra más?»). These tools return no customer.
- Refunds. Yoyos records no refund; money returned to a buyer outside Yoyos stays as a confirmed payment unless the seller voids it (see [Known risks](#known-risks)).
- Discounts. Yoyos records none: an item's subtotal is its unit price times its quantity.
- Cash as a payment method. Yoyos has no «Efectivo»; a cash sale is recorded with whichever method the seller picks, so the breakdown can only show the methods Yoyos records.

## Flow

1. The owner asks «¿cómo me fue este mes?». The agent calls **Resumen de ventas** without dates.
2. Yoyos answers the current month up to today in Lima, the previous period with its dates, the line that says what «Ventas» and «Recibido» mean, and «Hoy es 31/10/2026».
3. The agent answers in the owner's language with the figures unchanged and, when asked, follows with **Lo más vendido** or **Productos sin ventas** for the same dates.

Alternative paths:

- «¿Y en septiembre?»: the agent sends `desde: 2026-09-01`, `hasta: 2026-09-30`; the comparison is August.
- «¿Qué pedidos de octubre me deben?»: the summary's description sends the agent to **Buscar pedidos** with `pago: «por cobrar»`, `creado_desde: 2026-10-01` and `creado_hasta: 2026-10-31`; «¿cuánto me deben de todo?» goes to **Pedidos por cobrar**, which covers every unpaid order.
- «¿Qué talla de polo sale más?»: the agent calls **Lo más vendido** with `texto: «polo»`; when the polo it wants shows «y 4 variantes más», it calls again with that line's `producto` and gets every variant sold.
- «¿Qué casaca no se vende?»: **Productos sin ventas** with `texto: «casac»`.
- An invalid input is refused with the field and the remedy; the agent corrects and calls again.
- A period with too many orders to read at once is refused with «pide uno más corto»; the agent asks again with a shorter one.
- The store limit or a reading failure answers its usual text; repeating is always safe because nothing is written.

## Tools

Each tool follows the [common rules](../assistants.md#common-rules) of the assistant: store from the authorization, Spanish identifiers, titles, descriptions and messages, the agent answering in the owner's language, amounts as «S/ 1,480.00», dates shown as «31/10/2026», date inputs `AAAA-MM-DD`, unconfirmed catalog orders nonexistent, the «Hoy es …» line in every answer, product names shortened to 100 characters and combinations to 50.

| Identifier | Title | Answers |
| --- | --- | --- |
| `resumen_de_ventas` | Resumen de ventas | «¿Cómo me fue este mes?», «¿cuánto me pagaron por Yape de lo que vendí?», «¿cuál es mi ticket promedio?» |
| `lo_mas_vendido` | Lo más vendido | «¿Qué es lo que más vendí?», «¿qué talla de polo sale más?» |
| `productos_sin_ventas` | Productos sin ventas | «¿Qué no se está vendiendo?», «¿qué casaca no se vende?» |

### Period inputs (all three tools)

| Aspect | Behavior |
| --- | --- |
| Inputs | `desde` and `hasta`, both optional, `AAAA-MM-DD`, whole inclusive days in America/Lima. The description calls them the order's creation date, the same date as `creado_desde` and `creado_hasta` in **Buscar pedidos**, never the dispatch, delivery or payment date. |
| Default | Without both: from the 1st of the current month to today. With only `desde`: up to today. Only `hasta` is refused: «Indica también la fecha inicial (desde).» |
| Future end | A `hasta` after today is read up to today, and the answer states the period actually read: «Del 01/10/2026 al 20/10/2026 (hasta hoy)». Every figure, the previous period included, is computed on the period read. A `desde` after today is refused: «La fecha inicial (2026-11-05) es posterior a hoy (31/10/2026).» |
| Reversed | «La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).», the existing text. |
| Length | The period read has at most 366 days (initial value): «El periodo puede tener hasta 366 días. Pide uno más corto.» Criterion: a whole year, leap years included, is the longest period an owner names («¿cómo me fue este año?»). The value is lowered only if the technical design's load check shows that a store at the expected maximum volume cannot read 366 days within the read budget; the text then states the new number. |
| Format | Any other format is refused with the remedy, as in **Buscar pedidos**. |

### Resumen de ventas

Inputs: the period. Every answer, empty ones included, carries the period read and the previous period with its own dates. Every answer with sales carries one meaning line: «Ventas son los pedidos registrados en estas fechas, pagados o no. Recibido son los pagos confirmados de esas ventas, aunque se confirmaran después: no es lo que entró a tu cuenta en estas fechas.»

- «Ventas»: the sum of the totals of the period's sales, split into «productos» (item subtotals) and «envíos» (the delivery charge the buyer pays, never the internal delivery cost the seller pays the courier). An order with «Entrega por definir» adds nothing to «envíos».
- «Pedidos»: how many sales. «Ticket promedio»: sales divided by orders, rounded to the cent (half up); not shown with zero orders.
- «Recibido»: the confirmed payments of the period's sales, whatever the date they were confirmed, as of now. It is the sum of the «recibido» that **Buscar pedidos** shows for each of those orders, and uses the same word.
- «Por cobrar»: the sum of the balances of the period's sales that are not fully paid. «Exceso recibido»: the sum of overpayments, shown only when above zero. The three always reconcile: Ventas = Recibido + Por cobrar − Exceso recibido.
- «Por medio de pago»: received by method, largest first (ties by name A–Z), with its share of «Recibido» rounded half up to the whole percent, or «menos de 1%» below 0.5%: «Yape», «Plin», «Transferencia bancaria», and «Billetera digital sin especificar» for a wallet payment recorded without provider (other countries show the wallets of their catalog). A method without confirmed payments in the period is not listed. Shares are rounded one by one and may add up to 99% or 101%; the description says so and tells the agent not to adjust them.
- With sales but no confirmed payment: «Recibido: S/ 0.00» and «Todavía no hay pagos confirmados de estas ventas.» instead of the method breakdown.
- «Pagos por revisar»: «2 pagos por revisar en estos pedidos. Se aprueban o rechazan en Yoyos.», when buyer reports on the period's sales await review. They carry no amount and count nowhere until the owner approves them. A report on a cancelled order is not counted: it can no longer be approved or rejected.
- «Cancelados»: «3 pedidos cancelados (S/ 240.00) no cuentan en las ventas.», when orders created in the period are cancelled now.
- Money on cancelled orders: «En pedidos cancelados hay S/ 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.», shown only when the cancelled orders of the period still have confirmed payments; voided, rejected and reported payments never count for it. The remedy names the web because voiding a payment on a cancelled order is offered only there ([Orders · Payments](../orders.md#payments)).
- Next steps, in the description, not in the answer: the unpaid orders behind «Por cobrar» are listed with **Buscar pedidos**, `pago: «por cobrar»` and `creado_desde`/`creado_hasta` set to the period read; every unpaid order of the store, whatever its date, with **Pedidos por cobrar**; the orders with a payment to review show «Pago por revisar» in both lists, and the report is reviewed in Yoyos.
- «Periodo anterior»: a header with its dates, plus the month's name when it is exactly one calendar month («Periodo anterior: septiembre de 2026, del 01/09/2026 al 30/09/2026»; «Periodo anterior: del 01/09/2026 al 20/09/2026»), then sales, orders, average ticket and received of that period, each with the difference in amount and in percent rounded half up to the whole number: «Ventas: S/ 600.00 · +S/ 80.00 (+13%)». A figure that was 0 in the previous period shows the difference without percent («Recibido: S/ 0.00 · +S/ 380.00»). With no sales in the previous period the block says «Sin ventas en el periodo anterior.» and shows no differences. Received by method and owed are not compared.
- Empty period: «No hay ventas del 01/10/2026 al 31/10/2026.», followed by the cancelled lines when there are cancelled orders and by the previous period. A store with no orders at all: «Tu tienda todavía no tiene pedidos.», alone.
- Another currency: one block per currency, the store currency first and then the others by currency code A–Z, each complete and labelled with its currency: sales and its split, orders, average ticket, received and its methods, owed, overpaid, its cancelled lines and its own comparison with the previous period in that currency. The meaning line, the payments-to-review count and «Hoy es …» appear once.

### Lo más vendido

Inputs: the period, `orden` («unidades», the default, or «monto»), `texto`, `producto`, `pagina`.

- One line per product sold in the period's sales: current product name, units, amount (sum of its item subtotals, delivery excluded), share of the period's product amount rounded half up to the whole percent (or «menos de 1%»), the product identifier and the Yoyos product link.
- Under each product, its variants sold with their current combination, units and amount, most units first (ties by amount, then combination A–Z), at most 3 followed by «y 4 variantes más: pide este producto para verlas todas».
- Order: by units (ties by amount, then name A–Z) or by amount (ties by units, then name A–Z). 20 products per page with the total of products sold and «hay más: pide la página 2». Reason for 20 × 3: it is the shape **Buscar productos** already proves within the 24 KB budget at maximum lengths; 10 variants per product would not fit.
- Header: «Del 01/10/2026 al 31/10/2026: 11 unidades de 2 productos, S/ 640.00 en productos.» Shares are rounded one by one and may add up to 99% or 101%.
- `texto`: one phrase matched as in **Buscar productos** (partial, ignoring case and accents, on the product name or any variant SKU), up to 120 characters; the ranking, header and shares then cover only the matching products, and the header says «que coinciden con "polo"». The description repeats the singular-stem advice of **Buscar productos** («polo», «casac»).
- `producto`: the identifier returned by this tool or by **Buscar productos**. It answers that product alone with every variant sold in the period, no cap, so «¿qué talla de polo sale más?» is answered complete. `texto`, `orden` and `pagina` are ignored with it, and the description says so. A product of 60 variants at maximum lengths fits the 24 KB budget; a larger one still answers complete. Without sales in the period: «"Polo básico" no tuvo ventas del 01/10/2026 al 31/10/2026.». An unknown identifier, or another store's product: «No encontré ese producto en tu tienda. Búscalo con Buscar productos.», the existing text.
- Currency: the ranking, its amounts and shares cover only sales in the store currency. Sales in another currency are never ranked with them; each other currency adds one line: «Además vendiste en USD: 1 pedido, 3 unidades, US$ 90.00 en productos, fuera de este ranking.».
- Empty: «No vendiste productos del 01/10/2026 al 31/10/2026.»; with `texto`: «Ningún producto que coincida con "casac" se vendió del 01/10/2026 al 31/10/2026.». A page beyond the last: «Esa página no existe: hay 14 productos en total, 20 por página.», the existing text.

### Productos sin ventas

Inputs: the period, `texto`, `pagina`.

- Products that existed by the end of the period (created on or before its last day), with at least one active variant and total stock of active variants above 0, that have no unit in the period's sales. A product created after the period ends is never listed: it could not have sold then.
- Each product: name, current stock with its level summary as **Buscar productos** shows it («Stock: 12 · 1 con stock bajo»), the product identifier and Yoyos link, and:
  - «Última venta antes del periodo: 14/08/2026», the creation date of the latest sale with that product before the period started, or «Ninguna venta antes del periodo».
  - «Volvió a venderse el 15/10/2026», the first sale after the period, only when the period ended before today and there is one.
  - «Creado el 25/10/2026» when it was created inside the period.
  - Cancelled orders and unconfirmed catalog orders are never a sale for these dates.
- Order: most stock first, then oldest last sale before the period (none first), then name A–Z. 20 per page with the total.
- Stock is the current count, not the stock at the start of the period; the answer says so once: «El stock es el de hoy.».
- `texto`: the same phrase match as in **Lo más vendido**; the list covers only the matching products.
- A unit sold in any currency counts as a sale; the list shows no amounts.
- Empty: «Todos tus productos con stock tuvieron ventas del 01/10/2026 al 31/10/2026.»; with `texto`: «Todos tus productos con stock que coinciden con "casac" tuvieron ventas del 01/10/2026 al 31/10/2026.»; a store without products: «Tu tienda todavía no tiene productos.». A page beyond the last answers the existing page text.

### Server instructions

The orders paragraph drops «there are no sales totals or finances, so say so instead of adding pages of orders». The new tools' paragraph says:

- For totals, best sellers and products that do not sell, use these three tools; never add pages of orders.
- «Ventas» are registered orders not cancelled, paid or not; do not present them as money earned.
- «Recibido» is what the period's sales have paid, confirmed by the seller, whenever it was confirmed; it is not what came into the account during those dates, and the figures of a past period keep moving while its orders are paid or payments are voided.
- The comparison with the previous period comes computed with its dates; do not recompute it or compute other percents. Percents are rounded one by one and are not adjusted to add up to 100.
- Amounts in different currencies are never added; each currency is answered separately.
- Unpaid orders of a period: **Buscar pedidos** with `pago` «por cobrar» and the same creation dates; every unpaid order: **Pedidos por cobrar**.
- Money on cancelled orders is voided in Yoyos on the web, never through the agent.

## Rules

| Aspect | Behavior |
| --- | --- |
| Sale | Every order that is not cancelled and was created in the period, paid or not, from any source. An unconfirmed catalog order does not exist. |
| Date of a sale | The order's creation date in America/Lima: an order created on 31/10/2026 at 23:30 Lima belongs to October although it is 1 November in UTC. Reason: the same date the «Ventas» list and **Buscar pedidos** filter by. |
| Cancelled | Out of sales, orders, average ticket, received, owed, best sellers and products without sales; only the cancelled lines count them. An order cancelled after the period also leaves the period it was created in. |
| Received | Only `confirmed` payments. `reported`, `rejected` and `voided` payments never count. A payment confirmed on 03/11/2026 for an order of 28/10/2026 counts in October's «Recibido», so October's figures move until its orders are paid. |
| Owed | The balance of each period sale against its confirmed payments, the same rule as «Por cobrar» in Yoyos, limited to the period. **Pedidos por cobrar** keeps answering every unpaid order. |
| Payments on cancelled orders | Out of «Recibido»; confirmed ones are shown in their own line with the web remedy. |
| Pending reports | Counted only on the period's sales; never on cancelled orders. |
| As of now | Every figure is computed at the moment of the call, for the current and the previous period alike. Nothing is frozen at the end of a month. |
| Previous period | Computed on the period read (after a future `hasta` is cut to today). Three cases, in order: (1) whole calendar months compare with the same number of months just before; (2) a period that starts on the 1st and ends before the last day of its final month is moved back by the number of calendar months it touches, keeping the day numbers and cutting the end to that month's last day; (3) any other period compares with the same number of days just before. Examples in the table below. |
| Product and variant | Sales are grouped by the variant sold and shown with the product's current name and the variant's current combination; renaming a product does not split its sales. Deactivated variants keep their sales. Products are never deleted, and a variant that was ordered cannot be deleted ([Products](../products.md)). |
| Product amounts | Item subtotals at the price agreed in each order; the mentioned price never counts and Yoyos has no discounts. Delivery charges count in «Ventas» and «envíos», never in a product. The internal delivery cost is never read. |
| Currency | Amounts in different currencies are never added. A store whose orders all use the store currency (the usual case) sees one set of figures. The summary answers one complete block per currency; best sellers rank only the store currency and mention each other currency in one line; products without sales count units in any currency. |
| Days | America/Lima for every store, the assistant's rule. |
| Customer data | None of the three tools returns customers, recipients, phones or destinations. |
| Read only | The tools write nothing but the connection's «Último uso» and their log line, as every assistant tool. |
| Data scope | The tools read orders and products, both already listed on the consent screen. They are offered to connections that hold both current scopes (`orders:read` and `products:read`, which every connection holds today). No scope is added, no consent line changes and no connection is ended. |
| Store limit | Each call counts as one of the 60 per minute per store. |
| Too many orders to read | When the read of a period longer than 31 days exceeds its time budget: «Este periodo tiene demasiados pedidos para leerlo de una vez. Pide uno más corto, por ejemplo un mes.» Reason: repeating the same period would fail the same way. A period of 31 days or less over its budget, or any other failure, answers the reading-failure text, because a month is the shortest period worth asking for and its failure is most likely load, which passes. |
| Reading failure | «No pudimos leer tus ventas en este momento. Inténtalo de nuevo en unos segundos.», never an empty summary or an empty list. |

| Period read | Previous period | Case |
| --- | --- | --- |
| 01/10/2026–31/10/2026 | 01/09/2026–30/09/2026, «septiembre de 2026» | 1 |
| 01/07/2026–30/09/2026 | 01/04/2026–30/06/2026 | 1 |
| 01/10/2026–20/10/2026 (no dates, asked on 20/10, or `hasta` 31/10 cut to today) | 01/09/2026–20/09/2026 | 2 |
| 01/09/2026–20/10/2026 | 01/07/2026–20/08/2026 | 2 |
| 01/03/2026–30/03/2026 | 01/02/2026–28/02/2026 | 2 |
| 11/10/2026–17/10/2026 | 04/10/2026–10/10/2026 | 3 |
| 15/09/2026–14/10/2026 (30 days) | 16/08/2026–14/09/2026 | 3 |

Example, October 2026 asked on 05/11/2026 (Tienda Rosa, store currency PEN). Products: «Polo básico» at S/ 35.00 and «Casaca» at S/ 120.00.

| Order | Items | Envío | Total | Payments | Counts as |
| --- | --- | --- | --- | --- | --- |
| #1001, 03/10 | Polo básico M · Azul × 3 (S/ 105.00) | S/ 15.00 | S/ 120.00 | Yape S/ 120.00 voided; Yape S/ 120.00 confirmed | Sale; received S/ 120.00 |
| #1002, 10/10 | Casaca M · Negro × 1 (S/ 120.00) | — (recojo en tienda) | S/ 120.00 | Report rejected; Plin S/ 50.00 confirmed on 03/11 | Sale; received S/ 50.00, owed S/ 70.00 |
| #1003, 12/10, cancelled | Gorro × 4 (S/ 100.00) | — | S/ 100.00 | Yape S/ 40.00 confirmed; a report pending | Cancelled lines only |
| #1004, 20/10 | Polo básico L · Negro × 3 (S/ 105.00), Casaca L · Negro × 1 (S/ 120.00) | S/ 15.00 | S/ 240.00 | Report pending | Sale; owed S/ 240.00; one payment to review |
| #1005, 31/10 23:30 Lima | Polo básico M · Azul × 2 (S/ 70.00), Casaca M · Negro × 1 (S/ 120.00) | S/ 10.00 | S/ 200.00 | Yape S/ 210.00 confirmed | Sale; received S/ 210.00, overpaid S/ 10.00 |
| #1006, 15/10, catalog not confirmed | Polo básico S · Blanco × 5 (S/ 175.00) | — | S/ 175.00 | — | Does not exist |

Summary result: Ventas S/ 680.00 (productos S/ 640.00, envíos S/ 40.00), 4 pedidos, ticket promedio S/ 170.00, Recibido S/ 380.00 (Yape S/ 330.00, 87%; Plin S/ 50.00, 13%), Por cobrar S/ 310.00, Exceso recibido S/ 10.00, «1 pago por revisar en estos pedidos…», «1 pedido cancelado (S/ 100.00) no cuenta en las ventas.», «En pedidos cancelados hay S/ 40.00 en pagos confirmados…». Checks: 105 + 120 + 225 + 190 = 640 and 15 + 0 + 15 + 10 = 40; 120 + 50 + 210 = 380; 70 + 240 = 310; 380 + 310 − 10 = 680.

Best sellers for the same period: «11 unidades de 2 productos, S/ 640.00 en productos». By units: «Polo básico» 8 units, S/ 280.00, 44% (M · Azul 5, S/ 175.00; L · Negro 3, S/ 105.00), then «Casaca» 3 units, S/ 360.00, 56% (M · Negro 2, S/ 240.00; L · Negro 1, S/ 120.00). By amount, «Casaca» first.

Products without sales for the same period, other products of the store: «Bufanda» (stock 12, last sale 14/08/2026), «Gorro» (stock 8, its only sale is cancelled #1003, never sold otherwise), «Polo estampado» (stock 6, created 25/10/2026, never sold), «Chompa» (created 02/11/2026), «Short» (stock 0), «Vestido» (every variant deactivated). The list is «Bufanda» (Última venta antes del periodo: 14/08/2026), «Gorro» (Ninguna venta antes del periodo), «Polo estampado» (Ninguna venta antes del periodo · Creado el 25/10/2026); «Chompa», «Short», «Vestido», «Polo básico» and «Casaca» are not listed.

## When something fails

| Situation | What the agent receives |
| --- | --- |
| Success | The figures with the period read and «Hoy es …» |
| Invalid period | The field and the remedy (texts in [Period inputs](#period-inputs-all-three-tools)); nothing is read |
| Invalid `orden`, `texto` or `pagina` | «El orden puede ser "unidades" o "monto".», the existing text length and page texts |
| Unknown `producto` | «No encontré ese producto en tu tienda. Búscalo con Buscar productos.» |
| Page beyond the last | «Esa página no existe: hay 14 productos en total, 20 por página.» |
| Too many orders in a period longer than 31 days | «Este periodo tiene demasiados pedidos para leerlo de una vez. Pide uno más corto, por ejemplo un mes.» |
| Store limit | «Llegaste al límite de 60 consultas por minuto de tu tienda. No reintentes antes de 23 segundos.» |
| Reading failed | «No pudimos leer tus ventas en este momento. Inténtalo de nuevo en unos segundos.» |
| Connection ended or not authorized | The protocol's not-authorized answer, as every tool |

A read has no doubtful outcome with effect: repeating any call is safe and returns the figures of that moment.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Owner | The answers in their agent | Ask for any period up to 366 days | Change anything through the agent; void a payment through the agent |
| Connected agent | Sales figures, received by method, product units and amounts, current stock of products without sales, product identifiers and links | Read | Write; read another store; see customers in these tools; get margins or costs |

The consent the owner gave already lists «Tus pedidos: productos, montos, pagos, entrega y fechas» and «Tus productos: variantes, precios de venta, stock y si están en tu catálogo»; the three tools aggregate that same data, so the screen does not change.

## Information that is kept

Nothing new. Every figure is computed from current orders, payments and products at each call; no summary, ranking or snapshot is stored, and nothing records what the agent asked.

## Vocabulary

- Venta: an order that is not cancelled, in the period by its creation date, paid or not. The tools say «ventas», as the app's «Ventas» label.
- Recibido: confirmed payments of the period's sales, whenever confirmed; the same word and meaning as each order's «recibido» in **Buscar pedidos**. Not the money that arrived in the account during those days.
- Por cobrar: what the period's sales still owe; not every unpaid order of the store.
- Envíos: the delivery charge the buyer pays; never the internal delivery cost.
- Ticket promedio: sales divided by number of sales.
- Sin ventas: a product with stock that sold zero units in the period; «Productos sin ventas» is the tool's name for «lo que no rota».

## Known risks

- Abandoned chat orders inflate «Ventas» and lower «Ticket promedio»: an order created from WhatsApp messages stays active until the seller cancels it, paid or not. The meaning line and the instructions say «Ventas» are registered orders, paid or not, and «Por cobrar» shows the gap. Trigger to revisit (for example, a «Ventas pagadas» figure): owners saying the sales figure is higher than what they sold, or stores where more than a third of a month's sales still have no payment 30 days later.
- An owner who refunds outside Yoyos without voiding the payment sees «Recibido» overstated; on cancelled orders the money line asks them to void it on the web, on active orders nothing warns.
- «Recibido» differs from the wallet apps by date: a payment confirmed in November for an October sale counts in October. The meaning line says so in every answer.
- A month's figures are not final: they move while its orders are paid, voided or cancelled.

## Closed decisions

| Decision | Why |
| --- | --- |
| The summary reads orders and payments as they are now; nothing is stored | Same as every assistant tool; no figure can disagree with the order list |
| Reported, rejected and voided payments never count as received | Only a payment the seller verified is money ([Orders · Payments](../orders.md#payments)) |
| Cancelled orders are out of every figure except their own lines | Task rule; the lines explain why the total differs from the list and surface money held |
| A sale belongs to the period of its creation date in America/Lima | Same date the order filters use |
| Sales, received and owed reconcile exactly | The owner can check the answer with simple arithmetic |
| «Recibido», not «Cobrado» | The word existing tools use per order, so the summary adds up what **Buscar pedidos** shows |
| Ranking and products without sales are by product, variants inside; one product answers every variant | Owners speak of products; the variant breakdown answers sizes |
| 20 products per page, 3 variants each | The shape already proven within the 24 KB budget |
| No margins or costs in any of the three tools | Standing assistant rule |
| Amounts in different currencies are never added | A sum of soles and dollars is wrong |

## Changes to permanent documents on merge

Following question 3, `docs/assistants.md` changes when this feature is merged:

- Scope: «Six read-only tools» becomes nine, adding a sales group (**Resumen de ventas**, **Lo más vendido**, **Productos sin ventas**); «Every connection reads all six tools» becomes nine; «read customers or finances» in «Who sees and does what» loses «or finances».
- Tools table and server instructions: the three tools and the paragraph of [Server instructions](#server-instructions); the orders paragraph drops «no sales totals or finances».
- Rules, Consent scope: a new scope literal and consent line are added only when a tool reads data the consent does not list; a new group of tools over listed data requires the current scopes it reads and adds none. The sales tools require both `orders:read` and `products:read`.
- Decisions: «later tasks only add their scope literal» becomes «a later task adds a scope literal only for a new category of data».
- Architecture, Adding tools: a group of tools over existing data adds a module with the scopes it reads and no scope literal.
- When something fails: the sales reading-failure text and the too-many-orders text.
- Connecting an agent and checking the server: exactly nine tools.

The repository memories that say MCP 3/4 adds a «finanzas» scope literal are updated with the same criterion once round 2 is approved.

## Acceptance criteria

1. With the example orders above, **Resumen de ventas** for 2026-10-01 to 2026-10-31 asked on 05/11/2026 returns Ventas S/ 680.00 with productos S/ 640.00 and envíos S/ 40.00, 4 pedidos, ticket promedio S/ 170.00, Recibido S/ 380.00 with Yape S/ 330.00 (87%) and Plin S/ 50.00 (13%), Por cobrar S/ 310.00, Exceso recibido S/ 10.00, «1 pago por revisar», «1 pedido cancelado (S/ 100.00) no cuenta en las ventas.», «En pedidos cancelados hay S/ 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.» and the meaning line.
2. The voided S/ 120.00 of #1001, the rejected report of #1002 and the pending report of cancelled #1003 appear in no figure; voiding #1001's confirmed payment afterwards gives, on the next call, Recibido S/ 260.00 (Yape S/ 210.00, 81%; Plin S/ 50.00, 19%) and Por cobrar S/ 430.00. Voiding #1003's S/ 40.00 removes the money-on-cancelled line.
3. Order #1005, created on 31/10/2026 at 23:30 Lima, counts in October and not in November; an order created on 01/11/2026 at 00:05 Lima counts in November.
4. With three September sales totalling S/ 600.00 and S/ 500.00 received, the October summary shows «Periodo anterior: septiembre de 2026, del 01/09/2026 al 30/09/2026», Ventas «S/ 600.00 · +S/ 80.00 (+13%)», Pedidos «3 · +1 (+33%)», Ticket promedio «S/ 200.00 · −S/ 30.00 (−15%)» and Recibido «S/ 500.00 · −S/ 120.00 (−24%)». With no September sales it shows «Sin ventas en el periodo anterior.» and no differences.
5. Called on 20/10/2026 without dates, or with `hasta: 2026-10-31`, the summary reads 01/10/2026 to 20/10/2026, says «(hasta hoy)» in the second case, and compares with «del 01/09/2026 al 20/09/2026» without a month name. A period of 01/09/2026 to 20/10/2026 compares with 01/07/2026 to 20/08/2026, and 11/10/2026 to 17/10/2026 with 04/10/2026 to 10/10/2026.
6. The unconfirmed catalog order #1006 appears in no figure, ranking, unit count or «Última venta» date.
7. **Lo más vendido** for October with the example orders lists «Polo básico» first by units (8 units, S/ 280.00, 44%; M · Azul 5, L · Negro 3) and «Casaca» first by amount (3 units, S/ 360.00, 56%; M · Negro 2, L · Negro 1), with the header «11 unidades de 2 productos, S/ 640.00 en productos».
8. A product with 5 variants sold shows 3 and «y 2 variantes más: pide este producto para verlas todas»; called with its `producto` it lists all 5. `texto: «polo»` ranks only «Polo básico»; `texto: «casac»` with no casaca sold answers the no-match text.
9. Gorro, whose only October sale is in cancelled #1003, appears in **Productos sin ventas** for October with «Ninguna venta antes del periodo», and not in **Lo más vendido**.
10. **Productos sin ventas** for October lists Bufanda, Gorro and Polo estampado in that order, with their texts as in the example, and omits Chompa (created after the period), Short (stock 0) and Vestido (no active variant). For September asked on 05/11/2026, Casaca with a last sale on 20/08/2026 shows «Última venta antes del periodo: 20/08/2026 · Volvió a venderse el 10/10/2026», and Polo estampado is not listed.
11. A period with only cancelled orders answers «No hay ventas del …», the cancelled lines and the previous period. A period with one S/ 50.00 sale and no confirmed payment shows «Recibido: S/ 0.00», «Todavía no hay pagos confirmados de estas ventas.» and Por cobrar S/ 50.00, with no method breakdown.
12. Three methods with S/ 10.00 each show 33% each and the shares are not adjusted to 100%.
13. A period of 400 days, a `desde` after today, a reversed range and only `hasta` are each refused with their text and nothing is read; a page beyond the last answers the page text.
14. A read of a 200-day period over its time budget answers the too-many-orders text; a 31-day period over its budget answers the reading-failure text; neither answers zero sales or an empty list.
15. Another store's orders and products never change any figure or list of the authorized store, and its product identifier answers the not-found text.
16. A store with one order in USD and the rest in PEN sees a complete PEN block and a separate USD block, each with its own comparison; **Lo más vendido** ranks only PEN and adds the USD line; no amount adds both.
17. A page of 20 products at maximum lengths with 3 variants each, and a `producto` answer of 60 variants at maximum lengths, fit the 24 KB budget.
18. A call over the store limit answers the limit text with the seconds to wait.
19. Existing connections keep working after the release and see nine tools; the authorization screen is unchanged.

## Open items and questions

No open questions in round 2.

Decided unless objected:
- «Cobrado» is renamed «Recibido», the word existing tools use per order; the meaning is question 1's answer.
- Every answer with sales carries the meaning line for «Ventas» and «Recibido».
- Previous period: three cases on the period read, with month names only for a single calendar month; multi-month periods ending mid-month move back by the number of months they touch.
- `texto` on **Lo más vendido** and **Productos sin ventas**, and `producto` on **Lo más vendido** for every variant of one product.
- 20 products per page with at most 3 variants each.
- **Productos sin ventas** omits products created after the period, shows «Última venta antes del periodo» and «Volvió a venderse el …» for past periods; cancelled orders never count as a sale.
- Other currencies: complete summary block per currency; best sellers rank the store currency only, with one line per other currency.
- Too many orders: own text for periods longer than 31 days; the 366-day maximum lowered only on the load check's evidence.
- Only `hasta` stays refused (one extra round for the agent, accepted for clarity).
- Money held on cancelled orders and pending reports on cancelled orders follow question 2.

## Questions decided by the review gate

Decided in round 1 by the two review-gate reviewers (product and UX/UI), who agreed on every answer; the founder confirms them in the pull request.

1. **What does «Recibido» (round 1: «Cobrado») measure?** Answer: (1) the confirmed payments of the period's sales, whenever they were confirmed, with the answer's meaning line and the description saying it is not what came into the account in those dates. Reason: it is the only definition under which sales, received and owed reconcile, which the task's acceptance asks, and Yoyos knows when the seller confirmed a payment, not when the money arrived, so a date view would not match the wallet either. Discarded: (2) payments confirmed during the period, of any order, which breaks the reconciliation and splits an order paid across two months; (3) both as two lines, one more figure the agent can confuse.
2. **How do confirmed payments on cancelled orders count?** Answer: (1) out of «Recibido», with the line «En pedidos cancelados hay S/ 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.», shown only for confirmed (not voided) payments, pointing to the web because voiding on a cancelled order is web-only. Reason: the sale does not exist, and since Yoyos records no refund the owner must learn about money held. Discarded: (2) out without a line, which hides that money; (3) inside «Recibido», which breaks the reconciliation.
3. **Do the sales tools need their own consent line and data scope?** Answer: (1) no new scope or consent line, and no connection is ended. Criterion: a scope is added for new data, not for a new group of tools; these tools read only order amounts, payments, items and product stock, all listed on the consent screen, and require both current scopes. Reason: no access widens, so nothing justifies ending every connection. It departs from the memory notes that say MCP 3/4 adds a «finanzas» scope literal; the permanent-doc changes are listed in [Changes to permanent documents on merge](#changes-to-permanent-documents-on-merge). Discarded: (2) a new «Tus ventas…» line and scope, which ends every current connection for data the owner already consented to.
4. **Which orders are sales?** Answer: (1) every order not cancelled, paid or not, with the abandoned-chat-order risk written in [Known risks](#known-risks) and the meaning line saying «Ventas» are registered orders, paid or not. Reason: the same rule as «Por cobrar» and **Pedidos por cobrar**, and owed exists only if unpaid orders are sales. Discarded: (2) only orders with a confirmed payment, which makes two tools disagree on what is owed.
