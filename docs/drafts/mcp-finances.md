# Sales and best sellers in the AI assistant: product definition

**Status:** draft with open questions. Builds on the merged MCP 1/4 (orders) and 2/4 (products), documented in [AI assistants](../assistants.md), whose conventions apply unchanged unless this document says otherwise. Reads [Orders](../orders.md) as they work today; there is no sales summary or product ranking anywhere in Yoyos. Todoist task 6hrqGV5xvQFxGWQV («MCP 3/4: finanzas por periodo y lo más vendido en el MCP»), 31/10/2026.

## Problem and situation

On the last night of the month the owner of Tienda Rosa wants to know how October went. Today the connected agent can only list orders twenty at a time, and its instructions tell it that there are no sales totals, so it says so; if it tried, it would add pages by hand, mix cancelled orders, count a rejected receipt as money and miss the orders created after 19:00 Lima, which are already 1 November in UTC. Without the agent the owner scrolls the «Ventas» list, opens the Yape and Plin apps, adds in a notebook what came in by each method and still does not know whether September was better, which polo sold the most or which casaca has been sitting on the shelf all month.

## Goal

The owner asks their agent «¿cómo me fue este mes?», «¿cuánto entró por Yape?», «¿qué es lo que más vendí?» or «¿qué no se está vendiendo?» and gets figures that match the orders and payments Yoyos shows for that period, with the comparison against the previous period already computed.

Hypothesis: if it works, owners ask for the summary at least once a week; it would show as **Resumen de ventas** calls in `assistant_tool_called`, from more than one store, in the first month.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Owner closing the month at night, from the phone or the computer | Sales, what came in and what is still owed, by method, against last month | Their own agent, through the Yoyos connector |
| Owner deciding what to restock or put on offer | What sold most and what did not move | Their own agent |
| Connected agent | Ready figures and texts it does not have to compute | The three new tools |

There is no new screen in the Yoyos web or mobile app.

## First-version scope

- Three new read-only tools: **Resumen de ventas**, **Lo más vendido** and **Productos sin ventas**, added to the six of MCP 1/4 and 2/4.
- One period per call, given as whole days in America/Lima; by default the current month up to today.
- Summary: sales, number of orders, average ticket, collected, owed, overpaid, collected by payment method, payments awaiting review, cancelled orders left out, and the same figures for the previous period with the difference.
- Best sellers by product, with the variants that sold, ordered by units or by amount.
- Products with stock that sold nothing in the period.
- The server instructions stop saying that there are no sales totals and tell the agent to use these tools instead of adding pages.
- Meeting point with MCP 4/4 (stock alerts and orders waiting for stock): **Productos sin ventas** shows current stock with the variant levels of [AI assistants · Stock levels](../assistants.md#stock-levels) and does not alert; alerts belong to 4/4, which only adds its own tool.

## Out of this version

- Finance screens in the app, CSV export, an automatic daily or monthly summary (task scope).
- Breakdown inside a period by day, week, source (catálogo, WhatsApp, venta manual) or seller. Trigger: owners asking «¿qué día vendí más?» in the call logs.
- Margins, profit, cost of goods or inventory value at cost. The purchase price stays only in **Ver producto** and the agent never adds costs up ([AI assistants · Decisions](../assistants.md#decisions)).
- Variants without sales inside a product that did sell (sizes that do not move). Trigger: owners asking for it after the product-level version.
- Customer rankings («¿quién me compra más?»). Customers are not a category the agent reads.
- Refunds. Yoyos records no refund; money returned to a buyer outside Yoyos stays as a confirmed payment unless the seller voids it. Risk flagged: the summary can overstate collected money when an owner refunds without voiding (see [Open items](#open-items-and-questions), question 2).
- Cash as a payment method. Yoyos has no «Efectivo»; a cash sale is recorded with whichever method the seller picks, so the breakdown can only show the methods Yoyos records.

## Flow

1. The owner asks «¿cómo me fue este mes?». The agent calls **Resumen de ventas** without dates.
2. Yoyos answers the current month up to today in Lima, the previous month for the same days, and the «Hoy es 31/10/2026» line.
3. The agent answers in the owner's language with the figures unchanged and, when asked, follows with **Lo más vendido** or **Productos sin ventas** for the same dates.

Alternative paths:

- «¿Y en septiembre?»: the agent sends `desde: 2026-09-01`, `hasta: 2026-09-30`; the comparison is August.
- «¿Cuánto me queda por cobrar de todo?»: the summary answers only the period's orders, and its description sends the agent to **Pedidos por cobrar** for every unpaid order.
- An invalid range is refused with the field and the remedy; the agent corrects and calls again.
- The store limit or a reading failure answers its usual text; repeating is always safe because nothing is written.

## Tools

Each tool follows the [common rules](../assistants.md#common-rules) of the assistant: store from the authorization, Spanish identifiers, titles, descriptions and messages, the agent answering in the owner's language, amounts as «S/ 1,480.00», dates shown as «31/10/2026», date inputs `AAAA-MM-DD`, unconfirmed catalog orders nonexistent, and the «Hoy es …» line in every answer.

| Identifier | Title | Answers |
| --- | --- | --- |
| `resumen_de_ventas` | Resumen de ventas | «¿Cómo me fue este mes?», «¿cuánto entró por Yape?», «¿cuál es mi ticket promedio?» |
| `lo_mas_vendido` | Lo más vendido | «¿Qué es lo que más vendí?», «¿qué talla de polo sale más?» |
| `productos_sin_ventas` | Productos sin ventas | «¿Qué no se está vendiendo?», «¿qué tengo parado?» |

### Period inputs (all three tools)

| Aspect | Behavior |
| --- | --- |
| Inputs | `desde` and `hasta`, both optional, `AAAA-MM-DD`, whole inclusive days in America/Lima. |
| Default | Without both: from the 1st of the current month to today. With only `desde`: up to today. Only `hasta` is refused: «Indica también la fecha inicial (desde).» |
| Future end | A `hasta` after today is read up to today, and the answer states the period actually read: «Del 01/10/2026 al 20/10/2026 (hasta hoy)». A `desde` after today is refused: «La fecha inicial (2026-11-05) es posterior a hoy (31/10/2026).» |
| Reversed | «La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).», the existing text. |
| Length | At most 366 days (initial value, adjustable): «El periodo puede tener hasta 366 días. Pide uno más corto.» |
| Format | Any other format is refused with the remedy, as in **Buscar pedidos**. |

### Resumen de ventas

Inputs: the period. Every answer, empty ones included, carries the period read and the previous period with its own dates.

- «Ventas»: the sum of the totals of the period's sales, split into «productos» and «envíos» (delivery charges).
- «Pedidos»: how many sales; «Ticket promedio»: sales divided by orders, rounded to the cent (half up); not shown with zero orders.
- «Cobrado»: confirmed payments of the period's sales, whatever the date they were confirmed, as of now.
- «Por cobrar»: the sum of the balances of the period's sales that are not fully paid.
- «Exceso recibido»: the sum of overpayments, shown only when above zero. The three always reconcile: Ventas = Cobrado + Por cobrar − Exceso recibido.
- «Por medio de pago»: collected by method, largest first, with its share of «Cobrado» rounded to the whole percent: «Yape», «Plin», «Transferencia bancaria», and «Billetera digital sin especificar» for a wallet payment recorded without provider. A method without payments in the period is not listed.
- «Pagos por revisar»: «2 pagos por revisar en estos pedidos», when buyer reports await review; they carry no amount and count nowhere until the owner approves them.
- «Cancelados»: «3 pedidos cancelados (S/ 240.00) no cuentan en las ventas.», when there are any.
- «Periodo anterior»: sales, orders, average ticket and collected of the previous period, each with the difference in amount and percent: «Ventas: S/ 360.00 · septiembre: S/ 300.00 · +S/ 60.00 (+20%)». With zero in the previous period the percent is replaced by «sin ventas en el periodo anterior». Collected by method is not compared.
- Empty period: «No hay ventas del 01/10/2026 al 31/10/2026.», still followed by the previous period. A store with no orders at all: «Tu tienda todavía no tiene pedidos.».

### Lo más vendido

Inputs: the period, `orden` («unidades», the default, or «monto»), `pagina`.

- One line per product sold in the period's sales: current product name, units, amount (sum of its item subtotals, delivery excluded), share of the period's product sales in percent, and the Yoyos product link.
- Under each product, its variants sold with their current combination, units and amount, most units first, at most 10 followed by «y 4 variantes más».
- Order: by units (ties by amount, then name A–Z) or by amount (ties by units, then name). 20 products per page with the total of products sold and «hay más: pide la página 2».
- Header: «Del 01/10/2026 al 31/10/2026: 58 unidades de 14 productos, S/ 2,950.00 en productos.».
- Empty: «No vendiste productos del 01/10/2026 al 31/10/2026.».

### Productos sin ventas

Inputs: the period, `pagina`.

- Products with at least one active variant and total stock of active variants above 0 that have no unit in the period's sales.
- Each product: name, current stock with its level summary as **Buscar productos** shows it («Stock: 12 · 1 con stock bajo»), «Última venta: 14/08/2026» or «Sin ventas registradas», «Creado el 25/10/2026» when it was created inside the period, and the Yoyos product link.
- Order: most stock first, then oldest last sale (never sold first), then name A–Z. 20 per page with the total.
- Stock is the current count, not the stock at the start of the period; the answer says so once: «El stock es el de hoy.».
- Empty: «Todos tus productos con stock tuvieron ventas del 01/10/2026 al 31/10/2026.»; a store without products: «Tu tienda todavía no tiene productos.».

## Rules

| Aspect | Behavior |
| --- | --- |
| Sale | Every order that is not cancelled and was created in the period, paid or not, from any source. An unconfirmed catalog order does not exist. |
| Date of a sale | The order's creation date in America/Lima: an order created on 31/10/2026 at 23:30 Lima belongs to October although it is 1 November in UTC. Reason: the same date the «Ventas» list and **Buscar pedidos** filter by. |
| Cancelled | Out of sales, orders, average ticket, best sellers and products without sales; only the «Cancelados» line counts them. An order cancelled after the period also leaves the period it was created in. |
| Collected | Only `confirmed` payments. `reported`, `rejected` and `voided` payments never count. A payment confirmed on 03/11/2026 for an order of 28/10/2026 counts in October's collected, so October's figures move until its orders are paid. |
| Owed | The balance of each period sale against its confirmed payments, the same rule as «Por cobrar» in Yoyos, limited to the period. **Pedidos por cobrar** keeps answering every unpaid order. |
| Payments on cancelled orders | Excluded from collected (pending founder decision, question 2). |
| As of now | Every figure is computed at the moment of the call, for the current and the previous period alike. Nothing is frozen at the end of a month. |
| Previous period | A period of whole calendar months compares with the same number of months just before (October with September; 01/07–30/09 with 01/04–30/06). A period that starts on the 1st and ends before its month ends compares with the same days of the previous month, clamped to that month's last day (01/03–30/03 with 01/02–28/02). Any other period compares with the same number of days just before (11/10–17/10 with 04/10–10/10). |
| Product and variant | Sales are grouped by the variant sold and shown with the product's current name and the variant's current combination; renaming a product does not split its sales. |
| Product amounts | Item subtotals at the price agreed in each order; the mentioned price never counts. Delivery charges count in «Ventas» and «envíos», never in a product. |
| Currency | Amounts in different currencies are never added. A store whose orders all use the store currency (the usual case) sees one set of figures; an order in another currency gets its own figures, labelled with the currency. |
| Days | America/Lima for every store, the assistant's rule. |
| Customer data | None of the three tools returns customers, recipients, phones or destinations. |
| Read only | The tools write nothing but the connection's «Último uso» and their log line, as every assistant tool. |
| Store limit | Each call counts as one of the 60 per minute per store. |
| Reading failure | «No pudimos leer tus ventas en este momento. Inténtalo de nuevo en unos segundos.», never an empty summary or an empty list. Too large a period for the store to read in time answers the same text. |

Example, October 2026 asked on 05/11/2026 (Tienda Rosa):

| Order | Total | Payments | Counts as |
| --- | --- | --- | --- |
| #1001, 03/10 | S/ 120.00 | Yape S/ 120.00 voided, Yape S/ 120.00 confirmed | Sale; collected S/ 120.00 |
| #1002, 10/10 | S/ 80.00 | Report rejected; Plin S/ 50.00 confirmed on 03/11 | Sale; collected S/ 50.00, owed S/ 30.00 |
| #1003, 12/10, cancelled | S/ 200.00 | Yape S/ 40.00 confirmed | «Cancelados» only |
| #1004, 20/10 | S/ 100.00 | Report pending | Sale; owed S/ 100.00; one payment to review |
| #1005, 31/10 23:30 Lima | S/ 60.00 | Yape S/ 70.00 confirmed | Sale; collected S/ 70.00, overpaid S/ 10.00 |
| #1006, 15/10, catalog not confirmed | S/ 90.00 | — | Does not exist |

Result: Ventas S/ 360.00, 4 pedidos, ticket promedio S/ 90.00, Cobrado S/ 240.00 (Yape S/ 190.00, 79%; Plin S/ 50.00, 21%), Por cobrar S/ 130.00, Exceso recibido S/ 10.00, 1 pago por revisar, «1 pedido cancelado (S/ 200.00) no cuenta en las ventas.». 240.00 + 130.00 − 10.00 = 360.00.

## When something fails

| Situation | What the agent receives |
| --- | --- |
| Success | The figures with the period read and «Hoy es …» |
| Invalid period | The field and the remedy (texts in [Period inputs](#period-inputs-all-three-tools)); nothing is read |
| Invalid `orden` or `pagina` | «El orden puede ser "unidades" o "monto".», or the existing page text |
| Store limit | «Llegaste al límite de 60 consultas por minuto de tu tienda. No reintentes antes de 23 segundos.» |
| Reading failed or the period is too large to read in time | «No pudimos leer tus ventas en este momento. Inténtalo de nuevo en unos segundos.» |
| Connection ended or not authorized | The protocol's not-authorized answer, as every tool |

A read has no doubtful outcome with effect: repeating any call is safe and returns the figures of that moment.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Owner | The answers in their agent | Ask for any period up to 366 days | Change anything through the agent |
| Connected agent | Sales figures, collected by method, product units and amounts, current stock of products without sales, product links | Read | Write; read another store; see customers in these tools; get margins or costs |

The consent the owner gave already lists «Tus pedidos: productos, montos, pagos, entrega y fechas»; the summary aggregates that same data. Whether it still needs its own consent line and data scope is question 3.

## Information that is kept

Nothing new. Every figure is computed from current orders, payments and products at each call; no summary, ranking or snapshot is stored, and nothing records what the agent asked.

## Vocabulary

- Venta: an order that is not cancelled, in the period by its creation date. The tools say «ventas», as the app's «Ventas» label.
- Cobrado: confirmed payments of the period's sales. Not the money that arrived in the bank during those days.
- Por cobrar: what the period's sales still owe; not every unpaid order of the store.
- Ticket promedio: sales divided by number of sales.
- Sin ventas: a product with stock that sold zero units in the period; «Productos sin ventas» is the tool's name for «lo que no rota».

## Closed decisions

| Decision | Why |
| --- | --- |
| The summary reads orders and payments as they are now; nothing is stored | Same as every assistant tool; no figure can disagree with the order list |
| Reported, rejected and voided payments never count as collected | Only a payment the seller verified is money ([Orders · Payments](../orders.md#payments)) |
| Cancelled orders are out of every figure except their own line | Task rule; the line explains why the total differs from the list |
| A sale belongs to the period of its creation date in America/Lima | Same date the order filters use |
| Sales, collected and owed reconcile exactly | The owner can check the answer with simple arithmetic |
| Ranking and products without sales are by product, variants inside | Owners speak of products; the variant breakdown answers sizes |
| No margins or costs in any of the three tools | Standing assistant rule |
| Amounts in different currencies are never added | A sum of soles and dollars is wrong |

## Acceptance criteria

1. With the example orders above, **Resumen de ventas** for 2026-10-01 to 2026-10-31 asked on 05/11/2026 returns Ventas S/ 360.00 (productos and envíos adding up to it), 4 pedidos, ticket promedio S/ 90.00, Cobrado S/ 240.00 with Yape S/ 190.00 (79%) and Plin S/ 50.00 (21%), Por cobrar S/ 130.00, Exceso recibido S/ 10.00, «1 pago por revisar», and the cancelled line with S/ 200.00.
2. The voided S/ 120.00 of #1001 and the rejected report of #1002 appear in no figure; voiding #1001's confirmed payment afterwards lowers October's Cobrado to S/ 120.00 and raises Por cobrar to S/ 250.00 on the next call.
3. Order #1005, created on 31/10/2026 at 23:30 Lima, counts in October and not in November; an order created on 01/11/2026 at 00:05 Lima counts in November.
4. With three September sales totalling S/ 300.00, the October summary shows «septiembre: S/ 300.00 · +S/ 60.00 (+20%)» for sales and «−S/ 10.00 (−10%)» for the average ticket. With no September sales it shows «sin ventas en el periodo anterior» and no percent.
5. Called on 20/10/2026 without dates, the summary reads 01/10/2026 to 20/10/2026 and compares with 01/09/2026 to 20/09/2026.
6. The unconfirmed catalog order #1006 appears in no figure, ranking or «Última venta» date.
7. **Lo más vendido** for October with «Polo básico» sold 5 × «M / Azul» and 3 × «L / Negro» at S/ 39.90, and «Casaca» 2 units at S/ 120.00, lists «Polo básico» first by units (8, S/ 319.20) and «Casaca» first by amount (2, S/ 240.00), each with its variants.
8. A product whose only October sale is in cancelled order #1003 appears in **Productos sin ventas** for October, not in **Lo más vendido**.
9. **Productos sin ventas** lists a product with 12 units in stock and its last sale on 14/08/2026, and omits a product with 0 units and a product without active variants.
10. A period of 400 days, a `desde` after today, a reversed range and only `hasta` are each refused with their text and nothing is read.
11. Another store's orders never change any figure of the authorized store.
12. A store with one order in USD and the rest in PEN sees the PEN figures and a separate USD set; no amount adds both.
13. A call over the store limit answers the limit text with the seconds to wait; a failed read answers the reading-failure text, never zero sales.

## Open items and questions

Questions (answer with the option number):

1. What does «Cobrado» measure?
   (1) The confirmed payments of the period's sales, whenever they were confirmed. Recommended: sales, collected and owed reconcile, which is what the task's acceptance asks, and Yoyos records when the seller confirmed a payment, not when the money arrived, so a cash-by-date figure would not match the bank anyway.
   (2) The payments confirmed during the period, of any order. Matches «what came in this month»; collected and owed no longer add up to sales, and an order paid across two months splits.
   (3) Both, as two lines. Answers both questions; one more figure the agent can confuse, and more to compare and test.

2. How do confirmed payments on cancelled orders count?
   (1) Out of «Cobrado», with the line «En pedidos cancelados hay S/ 40.00 en pagos confirmados. Si los devolviste, anúlalos en Yoyos.». Recommended: the sale does not exist, and the owner learns about money that may have been refunded outside Yoyos.
   (2) Out of «Cobrado», without a line. Simpler; money held on a cancelled order goes unnoticed.
   (3) Inside «Cobrado». It is money Yoyos recorded; collected no longer reconciles with sales.

3. Do the sales tools need their own consent line and data scope?
   (1) No: they belong to the orders category the owner already consented to, and no connection is ended. Recommended: the summary only aggregates amounts, payments and products the consent already lists. This departs from the memory note that MCP 3/4 adds its own scope literal; that rule stays for a category with new data.
   (2) Yes: a new «Tus ventas: totales, cobros por medio de pago y lo más vendido» line and scope; every current connection ends and owners connect again, as in MCP 2/4.

4. Which orders are sales?
   (1) Every order not cancelled, paid or not. Recommended: it is the rule «Por cobrar» and **Pedidos por cobrar** already use, and owed exists only if unpaid orders are sales.
   (2) Only orders with at least one confirmed payment. Chat orders that never got paid do not inflate sales; owed shrinks to partial payments and no longer matches **Pedidos por cobrar**.

Decided unless objected:
- Three tools: **Resumen de ventas** (`resumen_de_ventas`), **Lo más vendido** (`lo_mas_vendido`) and **Productos sin ventas** (`productos_sin_ventas`), with their own reading-failure text «No pudimos leer tus ventas en este momento…».
- Default period: the current month up to today; only `desde` reads up to today; only `hasta` is refused; a future `hasta` is read up to today and stated.
- Maximum period 366 days (initial value, adjustable).
- Previous period: same number of whole months; month in progress against the same days of the previous month; otherwise the same number of days just before.
- A sale belongs to the period by its creation date, not by payment, dispatch or delivery date.
- Figures as of now; October's collected keeps moving while its orders are paid.
- «Ventas» is split into productos and envíos; average ticket rounded to the cent half up; percents rounded to the whole number.
- Payment methods: Yape, Plin, Transferencia bancaria and «Billetera digital sin especificar»; methods without payments are not listed; the method breakdown is not compared with the previous period.
- Pending buyer reports appear only as a count.
- Best sellers ranked by units by default or by amount, 20 products per page, at most 10 variants each, current names and combinations.
- Products without sales: at least one active variant and stock above 0, zero units in the period, ordered by most stock, with last sale date and «Creado el …» for products created inside the period; stock is today's.
- Orders in another currency get their own figures, never added to the store currency.
- The server instructions drop «there are no sales totals or finances» and tell the agent to use these tools instead of adding pages, and to use **Pedidos por cobrar** for every unpaid order.
