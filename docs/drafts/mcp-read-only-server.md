# Read-only MCP server for orders: product definition

**Status:** definition ready to implement. The review gate answered its questions (below) for the founder to confirm in the pull request. 30/10/2026. Today the store owner sees orders only in Yoyos web and mobile; the order list with filters, its «Por cobrar» and «Por entregar» views and the order detail already exist ([Orders](../orders.md)). There are no roles, and each Yoyos account belongs to at most one store. Todoist task `6hrqGV7M6QG42J53` (MCP 1/4). The design and implementation plan is in [mcp-read-only-server-technical.md](mcp-read-only-server-technical.md); this document defines only behavior.

## Problem and situation

The owner of a clothing store is having breakfast at 8 am and wants to know what to send today and who still owes money. Today they open Yoyos, filter «Por cobrar», scroll, open three orders to see the balance, then filter again by dispatch date. They already talk all day with ChatGPT or Claude on the same phone or computer, but those agents know nothing about the store: the owner copies numbers by hand or pastes screenshots, and the answer is only as good as what they pasted. When a customer writes «¿ya salió mi pedido?», the owner leaves the chat, looks the order up and comes back.

## Goal

The owner connects their own agent (ChatGPT, Claude, or any agent that accepts a remote MCP connector) to their Yoyos store once, and from then on asks it in plain language about their orders: find an order, see one order in full, what is still unpaid and what has to be dispatched today. The agent can read and never change anything, sees only that store, and never receives a customer's full phone, address or identity document.

Hypothesis: if it works, the owner asks the agent the morning questions («¿qué despacho hoy?», «¿quién me debe?») instead of filtering the list by hand. It would show in the operational log of tool calls (store, tool, time, outcome; see «Information that is kept») as connected stores that keep making calls on several days of the week after connecting.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Owner setting up the connector, usually at a computer, once | Find the connector address, add it to their agent and authorize their store | Yoyos web «Asistentes de IA» page; the agent's connector settings; the Yoyos authorization screen in the browser |
| Owner asking the agent at the start of the day or in the middle of a chat with a customer | Get a correct answer about their orders without opening Yoyos | Their agent's chat (ChatGPT, Claude, other) |
| The agent itself | Know which question each tool answers, what to pass and how to read empty results and errors | Tool descriptions, server instructions and responses of the Yoyos MCP server |
| Owner who wants to cut an agent's access (lost laptop, shared agent account) | See which agents are connected and disconnect one | Yoyos web «Asistentes de IA» page, also from the phone's browser |

## First-version scope

- One Yoyos MCP server address, the same for every store. The store is chosen by who authorizes, never by the address.
- Authorization in the browser: the owner signs in to Yoyos (or is already signed in) and allows the agent to read their store's orders.
- Four read-only tools about orders: **Buscar pedidos**, **Ver pedido**, **Pedidos por cobrar** and **Pedidos por despachar hoy**.
- Customer phones, addresses and identity documents hidden in every response.
- A limit of 60 tool calls per minute per store, shared by all the store's connected agents, with a clear error when it is exceeded.
- Web page «Asistentes de IA» in the settings navigation: connector address with **Copiar**, short connection steps, list of connected agents with **Desconectar**. Web only: connecting is done once, where the agent's connector settings live, and it is not a daily operation.
- Meeting point with MCP 2/4, 3/4 and 4/4 (products, finances, stock alerts): they add tools to the same server, under the same limit and the same masking. The consent lists only what this version reads. A later task that adds a category of data (products, finances, stock) does not grant it silently to an existing connection: the owner authorizes again, with that category listed in «Podrá ver», unless that task decides otherwise with the founder.

## Out of this version

- Any tool that writes: create, change, cancel, register, approve, reject or void payments. Trigger: a separate task with its own confirmation design.
- Customers, products, finances and stock tools: MCP 2/4, 3/4 and 4/4.
- Revealing a customer's full phone, address or document to the agent, even if the owner asks. Trigger: an owner who needs the agent to write to customers.
- A limit that survives a server restart. The counter starts again on each deploy (founder, 30/10/2026: rare and not a concern now). Trigger: more than one web instance.
- CSV export and a daily summary sent by Yoyos.
- Choosing which tools an agent may use, or connections that read only part of the orders. Every connection reads the four tools.
- A mobile «Asistentes de IA» screen. Trigger: owners asking how to cut an agent from the app; meanwhile the web page works from the phone's browser.
- A history of what each agent asked or received. Not kept.
- Several stores per account: an account belongs to one store today, so there is no store picker.

## Flow

1. The owner opens Yoyos web → «Asistentes de IA» and taps **Copiar** next to the connector address.
2. In their agent (for example ChatGPT or Claude, connector settings) they add a custom connector, paste the address and save. The agent opens a Yoyos window in the browser.
3. If the owner is not signed in to Yoyos in that browser, Yoyos shows its sign-in; after signing in it returns straight to the authorization screen.
4. The authorization screen shows which agent asks, for which store, what it will be able to read and what it will never do. The owner taps **Permitir acceso**.
5. Yoyos shows «Listo. Ya puedes volver a tu asistente.» and sends the browser back to the agent, which shows the connector as connected. The connection appears in «Asistentes de IA».
6. The owner asks the agent «¿qué pedidos tengo que despachar hoy?». The agent calls **Pedidos por despachar hoy** and answers which are ready and which are blocked and why.

Alternative paths:

- The owner taps **No permitir**: Yoyos shows «No diste acceso. Ya puedes volver a tu asistente.» and sends the browser back to the agent with access denied; nothing is created.
- The owner is signed in with another account: **Usar otra cuenta** signs out and shows the sign-in, then returns to the authorization screen.
- The account has no store yet, or its email is not verified: the authorization screen explains it and does not offer **Permitir acceso** (see Screens).
- The owner closes the window midway: nothing is created; they start again from the agent.
- The owner disconnects an agent from «Asistentes de IA»: its next tool call is refused as not authorized (see «When something fails»).

## Screens

Both web screens follow the interface language like every other page (Spanish and Portuguese today). The texts here are the Spanish ones; the Portuguese ones are their translation.

**«Asistentes de IA» (web, Settings navigation, after «Catálogo»):**

- Title «Asistentes de IA». Intro: «Conecta ChatGPT, Claude u otro asistente para preguntarle por tus pedidos. Solo puede leer: no crea, cambia ni cancela nada.»
- Block «Dirección del conector»: the address shown complete, never truncated (it wraps), and **Copiar**. After copying: «Dirección copiada.», announced politely. If the browser blocks the clipboard: «No pudimos copiarla. Selecciona la dirección y cópiala.» The error texts of this page use the «No pudimos…» voice and the retry and confirmation components of Settings → Catálogo, so it reads as the same product.
- Block «Cómo conectarlo», three numbered steps: «En tu asistente, abre los ajustes de conectores y agrega un conector personalizado.», «Pega la dirección y guarda.», «Inicia sesión en Yoyos si te lo pide y toca **Permitir acceso**.» Below: «Tu plan del asistente debe permitir conectores personalizados.» The steps do not name each vendor's menus, which change without notice. Once the store has at least one connection, the block is collapsed under «Cómo conectarlo» and opens on tap, so the page is the address and the list.
- Block «Asistentes conectados», newest first. Each row: the agent name, the domain it returns to (for example «chatgpt.com»), «Conectado el 30/10/2026» and «Último uso: hoy, 10:42», «Último uso: 28/10/2026, 10:42» for earlier days, or «Sin uso todavía», plus **Desconectar**. Dates and times in America/Lima. Under the list, and also under the empty state, one line: «Los asistentes se desconectan solos tras 90 días sin uso o si cambias tu contraseña.», so an owner whose agent stopped working knows where its row went.
- The list reloads when the browser tab regains focus, so an owner who connected in the agent and comes back sees the new row without reloading. The address and steps stay while it reloads.
- States: loading the list shows a placeholder for the rows; no connections: «Todavía no conectaste ningún asistente.»; load error: «No pudimos cargar la lista de asistentes.» with **Reintentar** (the address and steps still show, since they do not depend on the list). All connections are listed; a store does not reach 20 in practice.
- Accessibility: the page follows the same rules as the authorization screen, because it is the emergency path from a phone (lost laptop): **Copiar**, **Desconectar**, the «Cómo conectarlo» disclosure and the dialog buttons have at least the touch target size of the navigation links and a visible focus ring; the disclosure announces whether it is expanded or collapsed; each block has a heading.
- **Desconectar** asks «¿Desconectar ChatGPT, conectado el 30/10/2026?» with «Dejará de ver tus pedidos hasta que lo conectes de nuevo.», **Desconectar asistente** and **Mantener conectado**. The connection date tells apart two rows of the same agent. Success removes the row and shows «Desconectaste ChatGPT, conectado el 30/10/2026.», announced politely; focus moves to the next row's **Desconectar**, or to the «Asistentes conectados» heading when it was the last row. A failure shows «No pudimos desconectarlo. Inténtalo de nuevo.» next to the row, announced politely, with focus back on its **Desconectar**.

**Authorization screen (web, opened by the agent, often on a phone):**

- Signed in, store ready: title «ChatGPT quiere leer los pedidos de Tienda Rosa». The agent name is the one the agent declares, so it is followed by «(nombre indicado por el asistente)»; the domain it returns to is shown under it as body text of the same size and weight as the lists, never as muted caption text: «Volverá a chatgpt.com». Reason: a hostile site can call itself «ChatGPT»; the domain is the only part Yoyos verifies. Two lists:
  - «Podrá ver»: «Tus pedidos: productos, montos, pagos, entrega y fechas», «El nombre de tus clientes y de quien recibe el pedido», «Los últimos 3 dígitos del teléfono y el distrito de entrega de tus clientes».
  - «Nunca podrá»: «Crear, cambiar ni cancelar nada», «Ver teléfonos completos, direcciones ni documentos de tus clientes».
  - Footer: «Puedes desconectarlo cuando quieras en Ajustes → Asistentes de IA.» and «Conectado como rosa@ejemplo.com · **Usar otra cuenta**».
  - Main action **Permitir acceso**; secondary **No permitir**.
- Accessibility: the title is the page heading and is read as one sentence with the domain line; each list has its own heading and is a real list, not distinguished by color alone; **Usar otra cuenta**, **Permitir acceso** and **No permitir** have at least the touch target size of the navigation links on a phone and a visible focus ring; contrast follows the design system.
- Not signed in: the existing Yoyos sign-in, with the line «Inicia sesión para conectar tu asistente.»; on success it returns to this screen with the same request. «Crear cuenta» keeps working; a new account goes through email verification and store creation, and then the owner starts the connection again from the agent.
- Email not verified: «Verifica tu correo para conectar tu asistente. Después vuelve a tu asistente y conecta de nuevo.» with **Reenviar correo de verificación**, which opens the existing verification screen (check-email). No **Permitir acceso**.
- Account without a store: «Primero crea tu tienda en Yoyos. Después vuelve a tu asistente y conecta de nuevo.» with **Crear mi tienda** (the existing registration step). No **Permitir acceso**.
- Invalid or incomplete request (opened by hand, altered, unknown agent): «Este enlace de conexión no es válido. Vuelve a tu asistente y conecta de nuevo.»
- Request expired (more than 10 minutes on this screen, initial value, adjustable): «Esta solicitud venció. Vuelve a tu asistente y conecta de nuevo.»
- **Permitir acceso** shows progress on the button and disables both buttons until the answer arrives.
- After either answer Yoyos shows its text («Listo. Ya puedes volver a tu asistente.» or «No diste acceso. Ya puedes volver a tu asistente.») while it sends the browser back, so the owner never lands on a blank page if the agent cannot be opened from the browser.

## Tools

The agent sees each tool's name and description. Each tool has a stable ASCII identifier, resolved in implementation (for example `buscar_pedidos`), and the Spanish name used here as its display title. The descriptions are written for the agent, in Spanish (the language of the store and of the terms the owner sees in Yoyos) for every store, Portuguese-speaking ones included, since the agent answers in the owner's language. Each description says when to use the tool, when to use another, the exact values each input accepts and how to read the result. Server instructions shown to the agent once say: Yoyos is the store's sales system; this connector reads the orders of one store and cannot change anything; if the owner asks to change an order, the agent tells them to do it in Yoyos and gives the order link; amounts and dates come ready to show; customer phones and addresses are hidden on purpose and the agent must not claim it can get them; if a call is refused as not authorized, the agent asks the owner to connect the connector again from the agent's settings, and the address is in Yoyos → Ajustes → Asistentes de IA; this connector does not give sales totals or finances yet, so the agent says so instead of adding up pages of orders; when it relays a readiness reason it quotes it instead of turning it into a promise, and «Tiene un pago por revisar.» means asking the owner to review that report in Yoyos (with the order link), not to register a payment. Every list response states today's date in Lima («Hoy es 30/10/2026»), so the agent computes relative ranges («la semana pasada») on the store's day whatever its own clock says.

Common to every tool:

| Aspect | Behavior |
| --- | --- |
| Store | Always the authorized store. No tool accepts a store. |
| Order identity | The order number the owner sees, «#1001». The agent accepts «1001» or «#1001». |
| Customer | The buyer's name as recorded in the order. A buyer without a name: «Cliente que termina en 427» (the masked phone, where Yoyos shows the full one). An order without a buyer, or a buyer with neither name nor phone: «Público general», as Yoyos shows it. Phone only as its last 3 digits: «termina en 789». No identity document. |
| Destination | Home delivery: district, province and department only («Miraflores, Lima, Lima»); no street, number or reference. Agency: courier and agency with the agency's own address, which is business data. Store pickup: «Recojo en tienda» and the pickup point. No delivery assigned yet: «Entrega por definir», as Yoyos shows it. |
| Amounts | In the order's currency, formatted as Yoyos shows them: «S/ 120.00». |
| Date inputs | Calendar days as «2026-10-30», whole days in America/Lima, both ends included. The description says the format; any other is refused with the remedy. |
| Dates shown | «30/10/2026»; times «30/10/2026 10:42», in America/Lima. «Hoy» means today in Lima, whatever the agent's or owner's zone. |
| States | The words the Yoyos web shows: payment «Pagado» or «Pago pendiente» with «Por cobrar: S/ 40.00»; delivery «Pendiente», «Despachada», «Entregada»; order «Cancelado», «Completado»; «Pago por revisar» while a buyer report is pending. The checkout label «Pendiente de confirmación» / «Confirmado por el comprador» is not returned in this version. |
| Dispatch readiness | Shown in **Pedidos por despachar hoy** and **Ver pedido**; see the readiness table under **Pedidos por despachar hoy**. A cancelled order shows only «Cancelado», no readiness. |
| Unconfirmed catalog orders | A catalog order whose buyer has not confirmed it does not exist for the seller until then (founder, 16/10/2026), as in every Yoyos screen: it appears in no tool, and **Ver pedido** with its number answers «No hay un pedido #1234 en tu tienda.», like a nonexistent one. |
| Link | Each order carries its link to open it in Yoyos web. |
| Lists | Newest created first unless the tool says otherwise, 20 orders per page, with the total count and «hay más: pide la página 2» when there are more. |

**Buscar pedidos.** Intent: the general search when the owner names a customer, a number, a state or a date range («los pedidos de Carla», «lo que despaché la semana pasada con Olva»). Not for «¿quién me debe?» or «¿qué despacho hoy?», which have their own tools.

- Inputs, all optional, with these exact values: text (order number or part of the customer's name); payment «por cobrar» or «pagado»; delivery «pendiente», «despachada» or «entregada»; include cancelled, no by default; courier by name; created from and to; scheduled dispatch from and to, or «sin fecha de despacho»; dispatched from and to; page.
- Text does not search by phone, so the hidden phone cannot be reconstructed by trying numbers.
- Courier names match every courier the store has, including disabled ones that still have orders, as the Yoyos filter does: «lo que despaché con Shalom» works after Shalom was disabled. A name the store never had answers «Tu tienda no tiene el courier "Olba". Couriers: Olva Courier, Shalom.», listing the same couriers, so the agent can retry.
- Returns per order: number, created date, customer, source («Desde el catálogo» and «WhatsApp» as Yoyos marks them; «Venta manual» for the rest, new label, see Vocabulary), total, payment state with what is owed, delivery state with modality and courier, scheduled dispatch date, link. It does not show dispatch readiness nor the destination district; its description says both are only in **Ver pedido** and **Pedidos por despachar hoy**, so the agent asked «¿pedidos a Miraflores?» does not guess. The description also says that a buyer without a name («Cliente que termina en 427») is found only by order number or by the other filters, never by those digits, so the agent tells the owner that instead of guessing or paging through every order.
- Empty: «No hay pedidos con esos filtros.» A store with no orders at all: «Tu tienda todavía no tiene pedidos.» They are different answers.

**Ver pedido.** Intent: everything about one order the owner names by number («¿cómo va el #1042?», the customer asks whether their order left). If the owner names a customer instead of a number, the agent uses **Buscar pedidos** first.

- Input: order number.
- Returns: number, dates (created, scheduled dispatch, dispatched, delivered), source, customer, items (product, combination, quantity, unit price, subtotal, the price the customer mentioned when it differs), items total, delivery charge, total, received, balance, overpayment if any, payments (state, amount and method when confirmed, date, rejection reason; a receipt is mentioned as «con comprobante» and never sent), delivery (modality, recipient name, masked phone, destination as in the common rules, courier or agency or pickup point), order state, «Esperando stock» or «Descontando stock» when it applies, dispatch readiness while delivery is pending and the order is not cancelled, link.
- An unknown number, or one from another store: «No hay un pedido #1234 en tu tienda.» Same text in both cases.

**Pedidos por cobrar.** Intent: «¿quién me debe?», «¿cuánto me falta cobrar?». Orders not cancelled whose confirmed payments do not cover the total, the same rule as the «Por cobrar» view in Yoyos.

- Input: page only.
- Returns a summary first: count and total owed in the store's currency, over every order owed, not only the page («12 pedidos, S/ 1,480.00 por cobrar»). An order with «Pago por revisar» counts its full balance, because a reported payment does not count until the owner confirms it; the summary says how many have one («3 tienen un pago por revisar»). Then per order: number, created date, customer, total, received, balance, «Pago por revisar» when it applies, link.
- Empty: «No tienes pedidos por cobrar.»

**Pedidos por despachar hoy.** Intent: «¿qué despacho hoy?», «¿qué tengo que preparar?». Orders not cancelled, delivery «Pendiente», with a scheduled dispatch date of today or earlier in Lima. The description tells the agent that blocked orders appear with their reason and that it must not tell the owner a blocked order is ready.

- Input: page only.
- Returns a summary («Atrasados: 2, 1 listo. Para hoy: 6, 4 listos.») and two groups, «Atrasados» first (scheduled before today and still pending, with their date, which they keep until the owner reschedules), then «Para hoy». Within each group, ready orders first, then blocked ones; within each part, oldest scheduled date first, then lowest order number. Each order: number, customer, modality, courier or pickup point, destination district, payment state and balance, readiness, link. Then one line: «Además hay 5 pedidos pendientes sin fecha de despacho.» so the agent can offer them through **Buscar pedidos** with «sin fecha de despacho».
- Pages: the 20 orders per page follow that single sequence, so overdue orders are never pushed off page 1 by a busy day; «Para hoy» starts when «Atrasados» runs out. The summary and the undated line repeat on every page.
- Readiness follows the rules Yoyos applies to the «Marcar enviado» and «Marcar entregado» buttons ([Orders · Fulfillment buttons](../orders.md#fulfillment-buttons)), payment first, then stock, with the same sentences Yoyos shows next to those buttons:

| Order | Readiness shown |
| --- | --- |
| Home delivery or agency, at least one confirmed payment, enough stock (deducted, deducting, or available for every item) | «Listo para despachar» |
| Home delivery or agency, no confirmed payment | «Se requiere al menos un pago para despachar.» |
| Store pickup, paid in full and stock deducted | «Listo para entregar» |
| Store pickup, balance pending | «Se requiere el pago completo antes de entregar.» with «Por cobrar: S/ 40.00» |
| Home delivery or agency, waiting for stock, or partially paid and an item's current stock below its quantity | «Para despachar falta stock de Camisa (M · Azul).», naming only the short items |
| Store pickup, waiting for stock | «Para entregar falta stock de Camisa (M · Azul).» |
| Store pickup, stock being deducted | «El stock se está descontando; podrás entregarlo en menos de un minuto.» |
| No delivery assigned | «Entrega por definir: falta asignar la entrega.» |

  When a payment reason applies and the buyer has a payment report awaiting review, the line adds «Tiene un pago por revisar.», so the owner reviews it instead of registering a duplicate payment. Shipping deducts pending stock itself, so a deducting home or agency order is ready. A partially paid order with short stock is not «Esperando stock» in Yoyos and its button stays enabled until the tap fails; the tool marks it with the stock sentence anyway, because the owner must not prepare an order Yoyos will refuse to ship. The readiness reflects the order at the moment of the call, as the Yoyos detail does on load. It is computed per order and does not reserve stock among the listed orders: #1060 and #1061 each needing 3 «Camisa · M» with 4 in stock both show «Listo para despachar», and only the first one shipped succeeds, the same limit Yoyos has order by order. The description tells the agent so when several ready orders share a product.
- Empty: «No tienes pedidos para despachar hoy.» plus the line about undated pending orders when there are any.

## Rules

| Aspect | Behavior |
| --- | --- |
| Read only | No tool creates, changes or cancels anything, and none rejects or voids payments. The only thing a tool call records is its own connection's «Último uso» and its operational log line. |
| Store isolation | A connection reads only the store that authorized it. An order number of another store answers as nonexistent. |
| Consent scope | A connection reads only what its consent listed. A later category of data needs a new authorization unless the task that adds it decides otherwise with the founder. |
| Who can authorize | Any signed-in, verified Yoyos account with a store. There are no roles; the connection belongs to the store and records which account authorized it. |
| Limit | 60 tool calls per minute per store, counted across all its connected agents, in fixed one-minute windows. Discovering tools and connecting do not count. A call refused by the limit changes nothing. Example: two agents of Tienda Rosa make 40 and 21 calls in the same minute; the 61st is refused and the next minute both work again. |
| Limit after restart | The count starts from zero when the server restarts. Accepted (founder, 30/10/2026). |
| Masking | Every response, in every tool: phone only as its last 3 digits, no street address, no reference, no identity document. Customer names are shown. The owner cannot turn masking off in this version. |
| Days | «Hoy» and every date filter are whole days in America/Lima, inclusive. «Del 2026-10-01 al 2026-10-07» includes 7/10 until 23:59 Lima. |
| Connection life | A connection stays active until the owner disconnects it, until 90 days pass without any tool call, counted from authorization when it was never used (initial value, adjustable), or until the account that authorized it resets its password; connections authorized by another account of the same store are not affected. The agent renews its access by itself while the connection is active; the owner sees nothing. |
| Último uso | Every tool call that reaches the store updates its connection's «Último uso», including calls refused by the limit or by invalid input; a call refused as not authorized reaches no store and updates nothing. The 90 days count from that moment. |
| Signing out | Signing out of Yoyos web or mobile does not disconnect agents. Disconnecting is done in «Asistentes de IA». |
| Reconnecting | Connecting the same agent again creates a new connection; the old one keeps working until disconnected or inactive for 90 days. Both appear in the list with their dates. |
| Agent name | The name is what the agent declares; it is a notice, not verified. The domain it returns to is what Yoyos can verify, and both are shown together. |

## States

A connection:

| State | Meaning | What triggers it | What the owner sees | What the agent gets |
| --- | --- | --- | --- | --- |
| Active | The agent can read the store | **Permitir acceso** | Row in «Asistentes conectados» | Tool results |
| Ended | The agent can no longer read | **Desconectar**, 90 days without use, password reset of the account that authorized it | The row disappears | A not-authorized answer |

Transition: active → ended, final. A new connection is created by authorizing again. An ended connection is not shown.

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| **Permitir acceso** succeeds | «Listo. Ya puedes volver a tu asistente.», then the agent, which shows the connector as connected | Ask the agent |
| **Permitir acceso** twice (double click, back and repeat) | One connection; the second tap shows the same text and returns to the agent the same way | Nothing |
| **Permitir acceso** not sent (no connection) | «No pudimos enviarlo. Revisa tu conexión y vuelve a tocar Permitir acceso.» Buttons enabled again | Retry; the request is the same |
| **Permitir acceso** in doubt (sent, no answer) | «No sabemos si se conectó. Revisa tu asistente; si no aparece conectado, conecta de nuevo desde ahí.» | Check the agent or «Asistentes de IA»; repeating never creates two connections from the same request |
| **No permitir** | «No diste acceso. Ya puedes volver a tu asistente.», then the agent with access denied | Start again from the agent |
| **Desconectar** succeeds | Row removed, «Desconectaste ChatGPT, conectado el 30/10/2026.» | — |
| **Desconectar** on an already ended connection (other tab) | Same as success: row removed | — |
| **Desconectar** not sent or in doubt | «No pudimos desconectarlo. Inténtalo de nuevo.»; the list reloads, and the row stays only if the connection is still active | Retry |
| Limit exceeded | The agent receives «Llegaste al límite de 60 consultas por minuto de tu tienda. No reintentes antes de 23 segundos.», with the seconds left in the window also given as a number the agent can read. Other stores are not affected | The agent waits and retries; it does not retry in a loop |
| Connection ended or access expired | Yoyos answers the standard not-authorized response of the protocol, which lets the agent start the authorization again. What the agent shows (its reconnect prompt and wording) is the agent's own, not controlled by Yoyos; the server instructions ask it to tell the owner to reconnect | Authorize again |
| Invalid input (end date before start date, wrong date format, page 0, unknown delivery state) | «La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).», naming the field and the remedy | The agent corrects and retries |
| Reading failed (Yoyos could not read the orders) | «No pudimos leer tus pedidos en este momento. Inténtalo de nuevo en unos segundos.» Never an empty list | Retry |
| Server not reachable | The agent shows its own connection error | Retry later |

A read has no doubtful outcome with effect: repeating a call is always safe.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Owner (any account of the store) | Connector address, connected agents with name, domain, dates | Authorize, deny, disconnect | See what an agent asked |
| Connected agent | The store's orders through the four tools, masked | Read | Write anything; read another store; get full phone, address or document; read customers, products, finances or stock outside the order |
| Someone with the connector address | Nothing | Start an authorization, which requires a Yoyos sign-in | Read any data |

Protection and the risk it closes:

- Sign-in plus explicit consent, and a new consent for a new category of data: closes an agent reading a store, or a kind of data, its owner did not allow.
- Masking: closes customer phones, addresses and documents ending up in a third-party agent provider's history, where Yoyos cannot delete them.
- No phone search: closes reconstructing a masked phone by trying digits.
- Limit per store: closes one agent in a loop degrading Yoyos for every other store.
- 90-day inactivity end and end on password reset: closes a forgotten or compromised agent account reading indefinitely.
- Same answer for an order of another store and a nonexistent one: closes learning that another store's order numbers exist.

## Information that is kept

- Per connection, while active: the store, the account that authorized it, the declared agent name, the domain it returns to, what its consent listed, when it was authorized and when it was last used. Ended connections are not shown; whether they are deleted or kept is resolved in implementation.
- Per tool call, in the operational log like other server logs: store, connection, tool, time and outcome (answered, empty, limit, invalid input, failure). Never the inputs or the data returned. It is not shown to the owner; it is how the outcome hypothesis is read.
- Not kept: what the agent asked or received, the per-minute counters (ephemeral, lost on restart), the pending authorization request after it is answered or expires.
- The owner's orders are read current at each call; nothing is copied for the agent.
- Account data: connections belong to the store and survive signing out on any device.
- Existing stores start with no connections. There are no customers in production, so there is no transition.

## Vocabulary

- Asistente: the owner's AI agent (ChatGPT, Claude, other). The interface says «asistente»; «MCP» appears only next to the address, where vendors ask for it: «Dirección del conector».
- Conexión: one authorization of one asistente to one store; the interface says «asistente conectado».
- Por cobrar: not cancelled and confirmed payments below the total, same as the «Por cobrar» view.
- Por despachar hoy: not cancelled, delivery «Pendiente», scheduled for today or earlier. It differs from the «Por entregar» view, which also includes «Despachada» orders, because what the owner prepares in the morning is what has not left yet. The mobile app already uses «despachar» («Marcar como despachado»).
- Source labels: «Desde el catálogo» and «WhatsApp» are what Yoyos already marks; «Venta manual» is new, because the web shows nothing for an order a seller created, and the agent needs a word.
- Listo para despachar / listo para entregar: the order passes the same payment and stock rules as the Yoyos buttons; «entregar» for store pickup.

## Closed decisions

| Decision | Why |
| --- | --- |
| Read only, no write or payment-decision tool | Founder scope for MCP 1/4; writes need their own confirmation design |
| One address for every store; the store comes from the authorization | The address can be shared without exposing anything |
| 60 calls per minute per store, in memory, resetting on restart | Founder, 30/10/2026 |
| Phone, address and identity document never complete in any response | Founder acceptance criterion; data in a third party's agent cannot be recalled |
| Orders are identified by their visible number | It is what the owner and the customer say in the chat |
| Days in America/Lima | Same rule as every order filter in Yoyos |
| A new category of data needs a new authorization unless its task decides otherwise with the founder | The owner consented to what the screen listed; widening it silently breaks that consent |
| Blocked orders appear in «Pedidos por despachar hoy» with the Yoyos reason, never as ready | The owner must not prepare or promise an order the app will refuse to dispatch |
| Unconfirmed catalog orders do not exist for any tool, and **Ver pedido** answers them as nonexistent | Founder, 16/10/2026: such an order does not exist for the seller until the buyer confirms it; the agent must not see what the owner cannot |

## Acceptance criteria

1. Rosa, signed in to Yoyos web, copies the address from «Asistentes de IA», adds it as a custom connector in Claude, taps **Permitir acceso** for «Tienda Rosa», sees «Listo. Ya puedes volver a tu asistente.», asks «¿qué pedidos tengo por cobrar?» and gets her unpaid orders with the balance of each and the total owed; back on the open «Asistentes de IA» tab, the list shows «Claude», «Conectado el 30/10/2026» without reloading.
2. Rosa is not signed in: the connector opens the Yoyos sign-in with «Inicia sesión para conectar tu asistente.»; after signing in she lands on the authorization screen without starting over.
3. An account with an unverified email or without a store sees the matching message and no **Permitir acceso**.
4. Rosa taps **No permitir**: she sees «No diste acceso. Ya puedes volver a tu asistente.», the agent reports it could not connect and no row appears in «Asistentes conectados».
5. Rosa leaves the authorization screen open for 11 minutes and taps **Permitir acceso**: «Esta solicitud venció. Vuelve a tu asistente y conecta de nuevo.» and no connection is created. An authorization link with an altered parameter shows «Este enlace de conexión no es válido. Vuelve a tu asistente y conecta de nuevo.».
6. Rosa double-clicks **Permitir acceso**: exactly one row appears in «Asistentes conectados».
7. The connection of Tienda Rosa asks for order #1042, which exists only in Tienda Luis: «No hay un pedido #1042 en tu tienda.», identical to a number that exists in no store; no list or summary of Tienda Rosa ever includes an order of Tienda Luis.
8. Order #1001 has home delivery to «Av. Larco 123, Miraflores» for «Carla Pérez», phone 987654789, DNI 45678912: **Ver pedido** shows «Carla Pérez», «termina en 789», «Miraflores, Lima, Lima», and no response of any tool contains «987654789», «Av. Larco 123» or «45678912». An order whose buyer has only the phone 987654427 shows «Cliente que termina en 427»; an order without a buyer, or whose buyer has neither name nor phone, shows «Público general».
9. **Buscar pedidos** with text «987654789» does not find #1001 by phone.
10. Tienda Rosa's two agents make 61 calls within one minute: the 61st receives the limit message with the seconds left, Tienda Luis keeps getting answers in that same minute, and after the window both of Rosa's agents work again.
11. On 30/10/2026: #1050 home delivery scheduled 30/10 with a confirmed payment; #1051 agency scheduled 30/10 with no payment; #1054 agency scheduled 30/10 with no confirmed payment and a payment reported but not reviewed; #1052 home delivery scheduled 30/10, paid, waiting for stock of «Camisa (M · Azul)»; #1053 store pickup scheduled 30/10 with S/ 40.00 pending; #1048 scheduled 28/10, paid, enough stock, still pending; #1049 scheduled 31/10; #1047 pending without date. **Pedidos por despachar hoy** lists first «Atrasados» with #1048 (28/10/2026, «Listo para despachar»), then «Para hoy» with #1050 «Listo para despachar», then #1051 «Se requiere al menos un pago para despachar.», #1052 «Para despachar falta stock de Camisa (M · Azul).», #1053 «Se requiere el pago completo antes de entregar.» with «Por cobrar: S/ 40.00» and #1054 «Se requiere al menos un pago para despachar. Tiene un pago por revisar.» (same date, lowest number first); not #1049; and «Además hay 1 pedido pendiente sin fecha de despacho.»
12. A pending order with no delivery assigned, scheduled 30/10, appears under «Para hoy» with «Entrega por definir: falta asignar la entrega.». A home delivery order with S/ 30.00 of S/ 80.00 confirmed, scheduled 30/10, with 4 «Camisa · M» ordered and 3 in stock shows «Para despachar falta stock de Camisa (M).», not «Listo para despachar». A cancelled order scheduled 30/10 does not appear, and **Ver pedido** shows it «Cancelado» with no readiness.
13. A store with 3 overdue orders and 25 for today: page 1 shows the 3 «Atrasados» and the first 17 «Para hoy», page 2 the other 8, and both pages carry the same summary and undated line.
14. A call at 23:30 on 30/10/2026 Lima time (04:30 UTC on 31/10) counts «hoy» as 30/10.
15. **Pedidos por cobrar** with #1060 (S/ 100.00, nothing paid) and #1061 (S/ 80.00, S/ 30.00 confirmed and a payment reported but not reviewed) answers «2 pedidos, S/ 150.00 por cobrar» and marks #1061 «Pago por revisar». Catalog order #1070, created by a buyer who has not confirmed it, appears in no tool's list or summary, and **Ver pedido** with «#1070» answers «No hay un pedido #1070 en tu tienda.», as for a nonexistent number.
16. Shalom was disabled after dispatching #1030: **Buscar pedidos** with courier «Shalom» finds #1030; courier «Olba» answers «Tu tienda no tiene el courier "Olba". Couriers: Olva Courier, Shalom.».
17. **Buscar pedidos** created from «2026-10-07» to «2026-10-01» answers «La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).» and lists nothing.
18. Rosa disconnects «Claude» connected on 30/10/2026 from «Asistentes de IA»: the dialog names that date, the row disappears and Claude's next call gets the not-authorized answer.
19. A connection authorized on 01/08/2026 and never used, and another last used on 01/08/2026, are both ended on 30/10/2026 (90 days); their next call gets the not-authorized answer.
20. Rosa resets her password: every connection she authorized is refused on its next call; a connection authorized by another account of Tienda Rosa keeps working.
21. A store with orders but none matching «entregadas del 2026-10-01 al 2026-10-07» gets «No hay pedidos con esos filtros.»; a new store without orders gets «Tu tienda todavía no tiene pedidos.»; a reading failure is never answered as an empty list.
22. The server exposes no tool that creates, changes, cancels, approves, rejects or voids anything.
23. Claude's 61st call in a minute is refused by the limit: «Asistentes conectados» shows «Último uso: hoy» with that minute. A call with an ended connection changes no row.

## Questions decided by the review gate

For the founder to confirm in the pull request.

1. Where does the owner find the connector address and manage connected agents?
   - Answer: (1) web only, «Asistentes de IA» in Settings with address, steps, list and **Desconectar**.
   - Decided by: both reviewers (UX/UI and product).
   - Reason: connecting is done once, where the agent's connector settings live; revoking from a phone works through the web page in the browser; the web-and-mobile rule applies to daily operations and this is not one.
   - Discarded: (2) web and mobile, a mobile screen and its tests for a one-time task; (3) no page, which leaves a password reset as the only way to cut access.

2. What does «Pedidos por despachar hoy» include?
   - Answer: (1) pending delivery scheduled for today or earlier, overdue in their own group, plus a count of undated pending orders; each order with its dispatch readiness (blocker of the product review, resolved in «Tools»).
   - Decided by: both reviewers.
   - Reason: nothing scheduled is forgotten (overdue orders keep their date until rescheduled), undated orders are mentioned without flooding stores that do not schedule, and blocked orders are never presented as ready.
   - Discarded: (2) only today, which hides overdue orders; (3) every pending order, which equals «all pending» in stores that do not schedule.

3. How is the customer's phone shown to the agent?
   - Answer: (1) only the last 3 digits, «termina en 789», listed in the consent.
   - Decided by: both reviewers.
   - Reason: meets «ningún teléfono completo», tells apart namesakes and nameless buyers, and with no phone search it cannot be reconstructed or used to contact the customer.
   - Discarded: (2) fully hidden, which leaves nameless buyers indistinguishable.

4. Does «Pedidos por cobrar» return the total owed?
   - Answer: (1) count and total owed over every order owed, in the store's currency.
   - Decided by: both reviewers.
   - Reason: answers «¿cuánto me deben?» directly; it is the same data as the «Por cobrar» view, not period finances, so it takes nothing from MCP 3/4.
   - Discarded: (2) list only, leaving the agent to add pages and get money wrong past 20 orders.

5. Do tools added by MCP 2/4–4/4 reach existing connections without reauthorizing? (Was in «Decided unless objected»; the product reviewer objected.)
   - Answer: no. The consent lists only what this version reads; a later task that adds a category of data requires the owner to authorize again, unless that task decides otherwise with the founder.
   - Decided by: the coordinator, on the product reviewer's objection.
   - Reason: the owner consented to what the screen listed; finances in particular are more sensitive, and with no stores in production a new authorization costs nothing.
   - Discarded: silent widening; keeping it with a consent line saying access will grow with future read-only data.

## Review suggestions kept or changed

Every suggestion of the three review rounds was accepted; none was kept as it was. Where UX/UI r1 9(d) and the draft disagreed on what the agent shows when not authorized, the draft states only what Yoyos controls: the standard not-authorized response and the server instruction to ask the owner to reconnect. For the partially paid order with short stock (product r2 6), the draft takes the first option offered: the tool marks it with the stock sentence instead of «Listo para despachar», which differs from the enabled Yoyos button and is listed below for the founder. For a later task that adds a category of data, its new consent says «Nuevo permiso» so it does not read as a first connection (UX/UI r2, note for MCP 2/4–4/4).

## Decided unless objected

- The page is called «Asistentes de IA» and sits in the web Settings navigation after «Catálogo»; it reloads its list when the tab regains focus; «Cómo conectarlo» collapses once there is a connection; a line says agents unused for 90 days disconnect by themselves; errors use the «No pudimos…» voice and the Settings → Catálogo components; disconnect success and failure are announced politely with defined focus.
- Both web screens follow the interface language (Spanish, Portuguese); tool descriptions, server instructions and messages are in Spanish for every store.
- The authorization screen shows the agent's declared name marked «(nombre indicado por el asistente)» together with the domain it returns to as body text, lists what it can see (masked phone and district included) and what it can never do, and shows a «ya puedes volver a tu asistente» text after either answer.
- A pending authorization request expires after 10 minutes (initial value).
- A connection ends after 90 days without tool calls, counted from authorization when never used (initial value), and when the account that authorized it resets its password; signing out does not end it.
- Connecting the same agent twice creates two connections, both listed; the disconnect dialog and message name the connection date.
- Any account of the store can authorize and disconnect; the connection records who authorized it.
- Discovering tools and connecting do not count toward the 60-per-minute limit; every tool call does, across all the store's agents.
- States use the words the Yoyos web shows («Pago pendiente», «Pendiente», «Despachada», «Entregada»); «por despachar» is kept as the tool's name and defined against «Por entregar». The checkout label «Pendiente de confirmación» is not returned.
- Readiness reuses the exact Yoyos sentences («Se requiere al menos un pago para despachar.», «Se requiere el pago completo antes de entregar.», «Para despachar falta stock de …», «Para entregar falta stock de …»), adding «Tiene un pago por revisar.» when a report awaits review.
- Customer label: name; else «Cliente que termina en 427»; no buyer, or neither name nor phone, «Público general». Addresses reduced to district, province and department; identity documents never shown; agency and pickup point addresses shown because they are business data; no delivery «Entrega por definir».
- «Pedidos por despachar hoy» lists «Atrasados» first, then «Para hoy»; within each, ready first, then blocked, oldest scheduled date and then lowest number first; pages follow that one sequence and repeat the summary and undated line.
- A partially paid home or agency order whose items exceed current stock is marked «Para despachar falta stock de …», although Yoyos keeps its button enabled until the tap fails.
- A cancelled order shows «Cancelado» and no readiness.
- **Buscar pedidos** shows neither readiness nor destination district, and its description says where they are.
- Date inputs are «2026-10-30»; dates shown are «30/10/2026».
- Text search covers order number and customer name, not phone; courier search includes disabled couriers that have orders.
- Lists show 20 orders per page, newest first, with the total count, like the Yoyos order list.
- «Pedidos por cobrar» counts the full balance of orders with «Pago por revisar» and says how many have one.
- Each order carries its Yoyos web link, and the agent is told to send the owner there to change anything.
- Payment receipts are mentioned, never sent.
- The limit message gives the seconds to wait in words and as a number.
- Each tool call writes an operational log line with store, connection, tool, time and outcome, never inputs or data; nothing else about what agents ask is stored.
- Each tool has a stable ASCII identifier (resolved in implementation) and its Spanish name as display title.
- The «Asistentes de IA» page follows the authorization screen's accessibility rules; the 90-day line also names the password reset and shows in the empty state.
- The consent lists the recipient's name; the unverified state offers **Reenviar correo de verificación** and the no-store state says to return to the agent.
- Server instructions say there are no sales totals yet, to quote readiness reasons and to send «Pago por revisar» to review in Yoyos; list responses state today's date in Lima.
- Source labels «Desde el catálogo», «WhatsApp» and the new «Venta manual».
- Readiness is per order and does not reserve stock among the listed orders.
- «Último uso» is updated by every call that reaches the store, limit and invalid-input refusals included.
