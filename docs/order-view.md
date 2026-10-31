# Order view

The web has one screen to create and review an order: «Nueva venta» and «Pedido #1042» share the same sections, «Productos», «Pagos», «Cliente», «Enlace del pedido» and «Entrega». The seller corrects the products, customer and delivery of a saved order while it has not moved forward, and adds products with a floating picker that shows each variant with its stock. The order rules (items, stock, payments, locks) are in [Orders](orders.md); this document describes what the screen shows and how it behaves. Mobile has its own screens ([Orders · Mobile sales flow](orders.md#mobile-sales-flow)).

Sources of truth:

- Pure view model (drafts, pinned base, unsaved changes, invalid fields, estimates, request builders): `apps/core/src/features/orders/presentation/order-view-state.ts`.
- Screen and cards: `order-view.tsx`, `order-view-saved.tsx`, `order-products-card.tsx`, `order-customer-card.tsx`, `order-delivery-card.tsx`, `order-payments-panel.tsx`, `product-picker-dialog.tsx` in the same folder; routes `app/routes/order-new.tsx` and `app/routes/order-detail.tsx`.
- Texts: `app/locales.ts`, in Spanish and Portuguese.

## Saving model

- **New sale.** **Guardar venta** creates the order in one step, all or nothing: products, draft payments, customer, delivery (or none) and «Marcar como entregado al guardar» ([Orders · Creating an order](orders.md#creating-an-order)). The view then becomes «Pedido #1042» at the order's address, replacing the history entry of «Nueva venta» so the back button goes to Ventas. Focus goes to the heading and «Venta guardada.» is announced; the mark that asks for the announcement travels in `sessionStorage` because the redirect can be the action's own. Reason: back never lands on an empty «Nueva venta».
- **Saved order.** **Guardar cambios** saves products, customer and delivery together through [`editOrder`](orders.md#editing-a-saved-order), sending only the parts that differ from the saved order. Payments and fulfillment (**Marcar enviado**, **Marcar entregado**, **Cancelar pedido**) act at once. Reason: the balance shown equals the saved one, and approving or voiding is work that must not be lost with a discarded edit.
- **Unsaved changes.** The view compares each field with the saved order. Reverting an edit to the saved value removes it: «Tienes cambios sin guardar.» disappears and **Guardar cambios** and **Descartar cambios** go back to disabled. A saved order is never "empty"; a new sale is empty until something is typed or chosen, and **Descartar** is disabled then.
- **Leaving.** With unsaved changes, following a link, **Ver ventas** or the back button asks «¿Descartar los cambios?» (**Descartar cambios** / **Seguir editando**); closing or reloading shows the browser's own warning. **Descartar cambios** on a saved order asks the same and returns every field to the saved order. **Descartar** on a new sale asks «¿Descartar esta venta?». Nothing is kept: there is no draft. The guard stays active during a save and an in-doubt check.
- **Pinned base.** For each part (items, customer, delivery) the view keeps the saved state and revision it loaded. A part's base changes only when that part has no unsaved edit, or when its draft already equals the fresh state:
  - After a successful save, a part that was sent takes the result; a part with edits that were not sent keeps its base and draft. This is stricter than re-pinning every part. Reason: an edit not sent must still be compared with what it was made against.
  - After **Anular pago**, **Rechazar** or any other action that refreshes the order, parts with edits keep their base, so a change made elsewhere meanwhile is answered as a conflict on save.
  - After **Descartar y recargar**, every part takes the fresh state.
  - A successful save does not revalidate the loader: its result is the new state.
- **Invalid fields.** Save buttons are not disabled by an invalid field (quantity 0, incomplete delivery, half-typed customer, «Marcar como entregado al guardar» without covering payments). Pressing them sends nothing, shows «No se guardó: revisa 1 campo marcado.» and moves focus and scroll to the first invalid field in screen order, which carries its own message. Reason: a disabled button gives no way to find a field that is off-screen.
- **One at a time.** While a save, a payment action or a fulfillment action is in flight or in doubt, every save and every immediate action is disabled.

### Outcomes

Success, in-doubt and check messages show in a status line under the header and are announced politely; a success clears with the next edit. Known rejections show an alert under the header with a link to the marked element, and focus and scroll go to the first marked element. Conflicts and state changes show an alert with its remedy button, and focus goes to the alert.

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| **Guardar venta**: a variant is no longer available | The line marked «L / Azul ya no está disponible.»; everything else intact | Remove or change the line |
| **Guardar venta** with «Marcar como entregado al guardar» and no confirmed payment | The checkbox marked «Para marcarlo entregado, registra al menos un pago. Puede ser un pago parcial.» with focus; nothing saved | Add a payment (a partial one is enough) or uncheck it |
| **Guardar venta** with «Marcar como entregado al guardar» and short stock | «No hay stock suficiente para uno de los productos.»; nothing saved | Uncheck it or lower the quantity |
| Delivery price changed (`TOTAL_CHANGED`) | The rate marked «El precio de la entrega cambió a S/ 12.00. Revísalo y guarda de nuevo.»; the delivery is quoted again at the new price without choosing the district again; nothing saved, every edit intact | Review the price and save again |
| Rate or agency no longer available | The delivery marked «Esa opción de entrega ya no está disponible. Elige otra.»; the delivery is quoted again; nothing saved | Choose another option, or **Por definir** when the order has no delivery |
| **Guardar venta** not sent | «No se pudo guardar la venta. Revisa tu conexión e inténtalo de nuevo.»; form intact | Save again with the same order |
| **Guardar venta** in doubt | «No sabemos si la venta se guardó. Verificando…»; saving and leaving are blocked. The view reads the order by its id: if it exists, the saved view with «Venta guardada.»; if not, the form intact. Never a second order | Wait |
| **Guardar cambios** succeeds | «Cambios guardados.», or «Cambios guardados. El pedido queda esperando stock.» | Continue |
| The order changed meanwhile in a part being edited (`ORDER_CHANGED`) | «Este pedido cambió mientras lo editabas. Tus cambios siguen aquí; recarga para ver la versión actual.» with **Recargar pedido**, which asks «¿Descartar tus cambios y ver la versión actual?» (**Descartar y recargar** / **Seguir viendo mis cambios**) | Reload and redo the edits |
| Stock was deducted while editing products | Nothing: the save goes through and only the difference is adjusted | None |
| The saved edit of a deducted order adds units that do not fit | «Cambios guardados.» and, in **Productos**, the amber notice «Se guardó el cambio, pero no hay stock suficiente de X. Se descontará cuando haya.» (pt: same meaning) until the units are deducted | Wait for stock, or ship/deliver once it fits |
| The order was shipped or delivered meanwhile (`DELIVERY_LOCKED`), or cancelled | «El pedido ya se envió; no se guardaron los cambios.» (or «ya se entregó» / «está cancelado»), edits kept until reloading. After shipping or delivery with a customer edit, **Guardar solo el cliente** drops the other edits and saves the customer | **Recargar pedido** or **Guardar solo el cliente** |
| **Guardar cambios** not sent | «No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo.»; edits intact | Save again |
| **Guardar cambios** in doubt | «No sabemos si los cambios se guardaron. Verificando…», saving and immediate actions blocked until the check ends. The check re-reads the order and compares each sent part with the draft and with its pinned saved state: all equal to the draft is applied («Cambios guardados.», fresh revisions), all equal to the saved state is not applied (edits intact, saving enabled), any other is changed (the conflict alert). Repeating is harmless because the save sends the same final state | Wait |
| The in-doubt check fails | «No pudimos comprobar si se guardó. Revisa tu conexión y vuelve a comprobar.» with **Comprobar de nuevo**; saving stays blocked. Leaving asks «Puede que no se haya guardado. ¿Salir igualmente?» | **Comprobar de nuevo** |
| Picker cannot load | «No se pudo cargar el catálogo.» with **Reintentar**; lines already added stay | Retry |

A late response from an earlier attempt does not change the screen.

## Layout and header

- Two columns on wide screens. On narrow ones one column: «Estado del pedido» (saved orders, right after the header), «Productos», «Pagos», «Cliente», «Enlace del pedido», «Entrega». Every control has a touch target of at least 44 px.
- **Sticky bar on narrow screens**, once the header has scrolled out of view: for a new sale with products, the total and **Guardar venta**; for a saved order with unsaved changes, «Cambios sin guardar», the total, **Descartar cambios** and **Guardar cambios**; otherwise only the total. A cancelled order shows only the total. It wraps its actions to a second row instead of overflowing.
- **Breadcrumb:** Ventas › «Nueva venta» or Ventas › «Pedido #1042».
- **New sale:** chip «Sin guardar», hint «Completa los productos, pagos, cliente y entrega. Todo se puede editar después.», actions **Ver ventas**, **Descartar** and **Guardar venta** (disabled until there is a product; «Guardando…» while sending).
- **Saved order:** the [status labels](#status-labels), a subtitle with the date and origin («Creado el 30 oct, 09:10 · Registrado por el vendedor», «Pedido desde el catálogo» or «Pedido desde WhatsApp», adding «· Venta completada el …» when completed; the «Desde el catálogo» badge is not in the detail), and the actions **Imprimir rótulo**, **Ver ventas**, **Descartar cambios** and **Guardar cambios**. A cancelled order shows neither **Descartar cambios** nor **Guardar cambios** and no «Venta guardada.».
- **Unsaved changes note.** With unsaved changes the header shows once «Tienes cambios sin guardar. Guarda o descarta los cambios primero.». The controls it blocks (**Agregar <wallet>**, **Transferencia bancaria**, **Aprobar**, **Marcar enviado**, **Marcar entregado**, **Cancelar pedido**, **Imprimir rótulo**) stay in the Tab order as `aria-disabled` with that reason as a visually hidden description. Reason: the balance, the requirements and the label must be those of the saved order, and repeating the note beside each control only shifts the layout.
- **Stays enabled while editing:** **Anular pago**, **Rechazar** and **Ver captura**. They act on the saved order at once; afterwards the view refreshes payments, totals, payment status and stock state and keeps every pending edit.
- The «Esperando stock» / «Descontando stock» notice stays under the header ([Orders · Order detail: waiting for stock](orders.md#order-detail-waiting-for-stock)); **Cancelar pedido** is in «Estado del pedido» and opens its confirmation, which says the stock returns to the inventory.

### Status labels

| Order | Labels | Icon | Accessible name |
| --- | --- | --- | --- |
| Completed | «Venta completada» | Check | «Estado de la venta: Venta completada» |
| Cancelled | «Pedido cancelado» | Cross | «Estado del pedido: Pedido cancelado» |
| Active | «Pagada» or «Pago pendiente»; «Entregada», «Enviada» or «Entrega pendiente» | Card; truck | «Estado del pago: Pago pendiente», «Estado de la entrega: Enviada» |

- The text is direct, with no «Pago:» or «Entrega:» prefix. Header and list share one icon per dimension (card, truck, check or cross); the state shows in the text and in the color (warning for pending, info for shipped, success for paid, delivered and completed, muted for cancelled). Color is never the only signal.
- The sales list keeps its compact control (icons that open to show the text, which is also the accessible name and tooltip). An active order with a balance reads «Pago pendiente: S/ 148.00». A completed order shows only «Venta completada»; a cancelled one only «Pedido cancelado», with no payment, balance or delivery label. The buyer-confirmation line under the order number ([Checkout](checkout.md#link-and-access)) and the list's «Desde el catálogo» badge are unchanged.
- The shipped delivery state reads «Enviada», and the list filter «Enviado desde». Mobile says «Enviado» and «Enviado desde» in the same way.

## What can change when

| Order | Products | Customer | Delivery | Payments |
| --- | --- | --- | --- | --- |
| Active, delivery pending, stock not deducted (includes «Esperando stock», «Descontando stock» and «Stock pendiente») | Editable | Editable | Editable | Add, approve, reject, void |
| Active, delivery pending, stock deducted | Editable; only the difference moves stock ([Orders · Stock after an edit](orders.md#stock-after-an-edit)) | Editable | Editable | Same |
| Shipped | Locked: «El pedido ya se envió; los productos ya no se pueden cambiar.» | Editable | Locked: «La entrega ya salió; no se puede cambiar.» | Same |
| Delivered or completed | Locked: «El pedido ya se entregó; los productos ya no se pueden cambiar.» | Editable | Locked: «El pedido ya se entregó; la entrega no se puede cambiar.» | Same; voiding a payment can return a completed sale to active |
| Cancelled | Read-only | Read-only | Read-only | Only **Anular pago**; pending reports are read-only |

- What is locked is shown disabled with one note in its card that names the remedy; nothing the seller expects to find is hidden. A locked delivery explains itself once, without a second note or a repeated summary. Shipped and delivered orders get no remedy: the goods left, and corrections are agreed in the chat.
- A button blocked by a rule (the only line, unsaved changes, fulfillment requirements) stays focusable as `aria-disabled` with its note linked as its description, so keyboard and screen-reader users reach the reason. A state lock (see the table above) uses a real `disabled`.
- The screen locks products only when the order is shipped, delivered or cancelled, as core does ([Orders · Locks enforced by core](orders.md#locks-enforced-by-core)); a stock deduction in progress never locks anything, because it runs under the order lock and settles by the difference.

## Productos

- **Card header:** title, the count «3 productos · 3 unidades», **Agregar producto** with the «/» hint, and on a non-cancelled saved order the stock state «Stock descontado» or «Stock pendiente» ([Orders · Order detail: waiting for stock](orders.md#order-detail-waiting-for-stock)).
- **Each line (one per variant):** initials (no photo), name, the combination in web format («Talla M · S/ 89.00 c/u») or «Variante única», the mentioned-price note when it applies ([Orders · Mentioned price](orders.md#mentioned-price)), a stepper and the line subtotal, and a remove icon named after the line («Quitar Traje de Príncipe Azul, M»). A line above the shown stock keeps «Disponible: 3. Si lo cobras, el pedido quedará esperando stock.». With the stock unknown the warning is omitted.
- **Typed quantity:** whole numbers only. Empty or 0 marks the line «Escribe una cantidad de 1 o más.» and saving is refused as an invalid field; leaving the field empty restores the previous quantity. Typing 0 never removes the line: removing is the trash icon. Above 9999: «Máximo 9999 unidades.».
- **At least one product:** the remove icon of the only line and **−** at 1 are disabled; the note is «Un pedido necesita al menos un producto. Para anularlo, cancela el pedido.».
- **Deactivated variant:** a saved line can be lowered or removed, not raised: «Este producto ya no se vende; puedes bajar la cantidad o quitarlo.». The picker never offers it.
- **Adding** a variant already in the order adds to its line. A variant that is in the order both before and after the save keeps its saved price in the on-screen estimate too.
- **Totals:** «Subtotal», «Entrega» (only with a charge), «Pagado», «Total», and «Saldo pendiente» or «Exceso recibido: S/ 12.00». While there are unsaved changes or no save yet they are an estimate: «El total final se calcula al guardar con los precios vigentes.». The «Pagos» summary keeps showing the saved order's balance.
- **Empty:** «Aún no hay productos», «Pulsa / o Agregar producto para buscar.». The dashed row «Buscar producto por nombre…» opens the picker.
- **Locked:** the stepper, the remove icons and **Agregar producto** are disabled and the card shows the note of its state.

### Product picker

- A modal dialog, full screen below 640 px, with the search field «Buscar producto», the filters **Todos** and **Con stock** (toggle buttons with `aria-pressed`) and the counter «3 resultados». Results come from `GET /api/orders/catalog` ([Orders](orders.md#other-operations)); the filter is applied by the server.
- **Each product:** initials and name, its price or «Desde S/ 45.00» when variants differ (each chip then shows its own price). A product without options: «Variante única · 12 en stock» and **Agregar**. A product with options: «4 variantes · elige una para agregar» and one chip per active variant, with the combination and «5 en stock» or «Sin stock», plus «✓ 2» when the order already has 2 units.
- **Adding** one unit per press. A «Sin stock» chip can be added: it is not drawn as disabled, keeps a text contrast of at least 4.5:1 and uses the destructive text color plus the words; its line shows the stock warning. Reason: orders may be saved and charged without stock.
- **Keyboard and screen reader (combobox model).** Focus stays in the search field (`role="combobox"`, `aria-activedescendant` points to the highlighted option). The results are a `listbox`; each product is a `group` labelled by its name, and its chips or its **Agregar** button are `option`s. While nothing is highlighted, ← and → move the caret. ↓ highlights the first product (↑ the last); then ↑ ↓ move between products and ← → between the chips of the highlighted product. Typing, deleting or changing a filter clears the highlight. Enter adds the highlighted chip, or the product itself when it has no options; on a product with options and no chip highlighted it highlights the first chip without adding; with nothing highlighted it does nothing. Tab reaches the filters, every chip and **Agregar** as normal buttons, then **Listo**. Chip name: «M, 5 en stock, 2 en el pedido» (the last part only if the variant is in the order; a chip with its own price adds it). Every addition is announced politely: «Agregado: Traje de Príncipe Azul, M. 2 en el pedido.».
- **Footer:** «↑ ↓ productos · ← → variantes · Enter agregar · el selector sigue abierto para agregar más» (hidden without a fine pointer) and **Listo · 2 agregados** (or **Listo**). Esc or **Listo** closes the picker, what was added stays and focus returns to **Agregar producto**. The picker stays open after each addition. Reason: the seller adds several products in a row.
- **States:** «Buscando…»; «No encontramos "príncipe"» with «Prueba con otro nombre o crea el producto en otra pestaña.» and «Crear producto en otra pestaña»; «Todavía no hay productos»; «No se pudo cargar el catálogo.» with **Reintentar** keeping the text; «Mostrando los primeros 20. Escribe más para afinar la búsqueda.» shown at exactly 20 results.
- **Requests:** the search is debounced by 250 ms (the first, empty query is not); a new request aborts the previous one and only the latest may set the results; previous results stay visible while loading. The empty-query result is cached per filter value by a hook the view mounts, so it outlives the dialog; a successful save and every revalidation drop it, and the next opening fetches again. A closed picker never sends a request.
- **Shortcut «/»:** opens the picker only when focus is not in a text field, no other dialog is open and products are editable. **Agregar producto** shows it as a visual hint (`<kbd>`) only; it does not declare it with `aria-keyshortcuts`.
- The catalog search matches product names only; products have no categories ([Products](products.md)).

## Pagos

- Summary: «Sin pagos · necesario para enviar», «Pago parcial · falta S/ 148.00», «Pagado», «Pagado · Exceso recibido: S/ 12.00», plus «Pago por revisar» while a report is pending. The rows and their actions are described in [Orders · Web «Pagos» card](orders.md#web-pagos-card).
- One **Agregar <wallet>** button per wallet of the country's catalog (**Agregar Yape**, **Agregar Plin** in Peru) and **Transferencia bancaria**, while the order is not cancelled, has a product and has a balance. Without products: «Agrega productos para registrar pagos.». Empty: «Aún no hay pagos registrados.».
- **Saved order:** each action opens the payment form with the method preset and «Importe recibido» prefilled with the balance; the partial stock box follows its [rule](orders.md#payments). Payment actions refresh the order afterwards.
- **New sale:** each action adds a draft row prefilled with the balance at that moment and editable, with **Quitar** until **Guardar venta**. A later product change does not touch an amount already typed. An invalid draft amount is marked on its field.

## Cliente

- Optional «Nombre» and «Celular» (phone with a country selector, Peru by default; stored in E.164) and the hint «Escribe su nombre y celular.». A name without a phone, or the reverse, marks the missing field «Completa nombre y celular, o deja ambos vacíos.». There is no search of saved contacts.
- Allowed in every state except cancelled, completed sales included.
- **Quitar cliente** empties both fields; saving shows «Público general». A WhatsApp order keeps its mark and offers no **Quitar cliente**; with no name or phone it shows «Cliente del chat de WhatsApp. Agrega su nombre y celular si los conoces.». Emptying both fields after setting them keeps the contact and returns to that state.
- On an order the buyer confirmed ([Checkout](checkout.md#confirmation)), the card is titled «Cliente» (not optional), offers no **Quitar cliente** and shows «El comprador confirmó este pedido con sus datos. Puedes cambiar el cliente, pero no dejarlo vacío.». Emptying both fields marks the name as incomplete before saving, and a save that reaches the server is refused with `CUSTOMER_REQUIRED`. Changing the customer to another name and phone works as always.

## Estado del pedido

Saved orders only, at the top of the right column (right after the header on narrow screens, before «Productos»). Title «Estado del pedido», the delivery modality as subtitle («Entrega a domicilio», «Entrega por agencia», «Recojo en tienda», «Entrega por definir» without delivery) and a badge (Pendiente, Enviado, Entregado, Cancelado). Component: `order-status-card.tsx`.

- **Stepper** (ordered list, `aria-current="step"` on the current step): Pendiente → Enviado → Entregado, or Pendiente → Entregado for store pickup; a cancelled order shows Pendiente → Cancelado with a red connector. Each reached step shows its date («Hoy 09:10» today, «29 oct» otherwise, Lima time); a delivery made straight from pending shows «Enviado» done without a date.
- **Actions** (only what the backend supports): pending with shipping, **Marcar enviado** plus the links **Entregar directamente** and **Cancelar pedido**; pending store pickup, **Marcar entregado** and **Cancelar pedido**; shipped, **Marcar entregado** alone. Delivered shows «Entregado a <destinatario> el 30 oct, 16:40.»; cancelled shows «Pedido cancelado el 29 oct, 18:40.» plus «El stock de los productos se devolvió al inventario.» when the order had its stock deducted. There is no undo, back-to-pending or reopen.
- **Blocks.** Without a confirmed payment the primary button and **Entregar directamente** are `aria-disabled` and an amber note says «Registra al menos un pago para enviar (entregar, en recojo). Puede ser un pago parcial.» with **Agregar pago**, which scrolls to and focuses «Pagos». Waiting stock and unsaved changes disable them the same way; **Cancelar pedido** stays enabled except with unsaved changes or while another action runs. Delivering with a balance due is allowed; completion waits for the payments to cover the total ([Orders](orders.md)).

## Enlace del pedido

- Before saving: grey, with the input, copy and open buttons disabled and a lock next to «Disponible al guardar».
- Saved: the card of [Checkout · Link and access](checkout.md#link-and-access). Without a subdomain: «Elige el link de tu tienda para compartir este pedido.» and **Ir a Apariencia de la tienda**. Cancelled: «Pedido cancelado».

## Entrega

- A saved order's transitions live in [«Estado del pedido»](#estado-del-pedido), not here. In a new sale, «Marcar como entregado al guardar» with its requirements.
- **Method tabs:** **Por definir**, **Domicilio**, **Agencia** and **Recojo en tienda**, only the enabled methods, with a touch target of at least 44 px. A new sale starts at **Por definir** («Entrega por definir. Puedes guardar sin entrega y elegirla después.»). Choosing a method shows its fields open. Choosing **Por definir** again before saving discards the half-filled delivery. On a saved order with a delivery, **Por definir** is disabled with «Una entrega guardada se puede cambiar, pero no quitar.». Reason: core has no operation that clears a delivery; it is replaced.
- **Incomplete delivery:** the missing fields are marked and saving is refused as an invalid field, with «Completa la entrega o elige Por definir.» (new sale or order without a delivery) or «Completa la entrega o descarta sus cambios.» (order with a delivery).
- **Destinatario:** name, phone and, for agency, the identity document, plus «Igual que el cliente»:
  - New sale: checked by default; while checked the recipient mirrors the customer, and editing a recipient field unchecks it.
  - Saved order: checked only if the saved recipient's name and phone equal the customer's (phones normalized); otherwise unchecked with the saved recipient.
  - **Quitar cliente** with the box checked unchecks it and the recipient keeps the last mirrored values.
  - Once the delivery is locked the recipient is frozen, the box is disabled and changing the customer does not change it.
- **What a save sends:** an untouched delivery is not sent (it keeps its rate, price, recipient and author, including «Elegida por el comprador»). Changing only the recipient, address text, reference or identity document sends an amendment, with no new quote. Changing the method, district, rate or agency sends a replacement, quoted with the price the seller saw. A saved delivery that is a store pickup can only be amended (the recipient); its pickup point stays as saved and cannot be replaced from the screen.
- **Quoted price:** «Costo de entrega (interno)» is read-only and comes from the chosen rate. On a saved order the card records the quoted price when the seller picks a rate, so a replacement carries the price it expects. Changing only the rate within the same district needs the district to be picked again.
- «Elegida por el comprador» shows under the method while the delivery is the buyer's choice. Without an enabled method the card shows «La modalidad de entrega no está disponible. Revisa la configuración para asignarla.» and the link **Configurar modalidades de entrega**.

## Not offered

- Product photos, categories, searching by variant value, saved contacts in «Cliente», operation number and payer on payment rows, returning a saved delivery to «Por definir», and repricing a kept line are not offered.
- Editing products on mobile is not offered.
