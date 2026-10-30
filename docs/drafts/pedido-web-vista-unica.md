# Single order view on web: product definition

**Status:** definition ready to implement. 30/10/2026. Product review gate: round 1 rejected by both reviewers (UX/UI 7 blockers, product 3 blockers); round 2 approved by both. The questions decided by the gate are pending the founder's confirmation in the pull request. Today the web has two screens: «Nueva venta» (`apps/core/app/routes/order-new.tsx`, a flat product list plus payment and delivery forms) and the order detail (`apps/core/app/routes/order-detail.tsx`, read-only items and customer, payments card, delivery editor, «Detalles internos»). This draft defines part 1 of 3 of the order redesign. It changes rules in [Orders](../orders.md): the seller can now edit the items and the customer of an existing order, the «Detalles internos» stock line moves, and the web «Pagos» card, the web sales flow and the list labels change. It also changes [Checkout](../checkout.md): the seller can change the products of a confirmed order. The [Orders](../orders.md#stock-deduction) sentence saying a deduction is attempted «never through a seller action on the order» changes too: saving products becomes a trigger. Todoist [6hrqQ4cCp8pWVjq3](https://app.todoist.com/app/task/6hrqQ4cCp8pWVjq3). Visual reference: the approved mockups `01-nueva-venta.png` and `02-pedido-guardado.png` (on the founder's machine, in `~/agent-context/yoyos/pedido-unificado-2026-10-30/`). `03-estados.png` belongs to part 2.

## Problem and situation

A buyer writes on WhatsApp «mejor la talla L y agrégame la corona». The order already exists, maybe with a S/ 150.00 Yape advance recorded. Today the seller cannot change its products from the web or from the phone. The only way out is to cancel the order, which keeps the payment on a cancelled order, and type a new sale from zero. Then the payment has to be recorded again and a new link shared. Orders created from chat messages make it worse: when a message produces a wrong or missing item, the seller has no remedy.

On top of that, creating a sale and reviewing it are two different screens with different layouts. The flat product list of «Nueva venta» shows one row per variant («Variante única · Stock: 3»), so a costume with four sizes takes four rows and the seller scrolls instead of choosing.

## Goal

The seller creates and reviews an order on the same web view. On that view they correct its products, customer and delivery while the order has not moved forward, and they add products with a floating picker that shows each variant with its stock.

Hypothesis: sellers stop cancelling orders whose stock is not yet deducted just to change their products. It would show as fewer cancellations of non-deducted orders followed by a new order for the same buyer within the hour. Orders already deducted keep needing cancel and recreate until the deferred item below is built, so they are left out of the measure.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller typing a sale while the customer waits in the chat | Add several products and sizes fast, record the advance, share the link | Web, «Nueva venta» |
| Seller correcting an order after the buyer changed their mind in the chat | Change sizes and quantities, fix the customer, change the delivery, without losing payments | Web, saved order |
| Seller reviewing a buyer-reported payment or the order state | See what is paid and delivered at a glance, approve or reject the receipt | Web, saved order and sales list |
| Buyer with the order link | See the current products and total | Checkout (screens unchanged) |

Mobile does not change in this task (question 4).

## First-version scope

1. One view for creating an order and for a saved order, with the same sections: «Productos», «Pagos», «Cliente», «Enlace del pedido» and «Entrega».
2. A floating product picker with one chip per variant and its stock. It opens with **Agregar producto**, with the search row of the products card or with the «/» key. The flat product list disappears.
3. On a saved order the seller adds, removes and changes quantities of products, records payments, sets, changes or clears the customer and changes the delivery, under the rules below. Core gets the new operations to edit products and to set or clear the customer, with their tests. [Orders](../orders.md) and [Checkout](../checkout.md) are updated when the feature merges (question 5).
4. Before saving, the order link is shown grey and disabled with «Disponible al guardar».
5. «Detalles internos» disappears. Each piece it held moves elsewhere or is dropped (see Rules · Where «Detalles internos» goes).
6. Header status labels: «Venta completada» alone for a completed sale; otherwise payment and delivery labels with icons and contextual accessible names. The sales list uses the same texts and icons.
7. What core forbids in the current state is shown disabled with a short note that names the remedy, never as a surprise error.
8. New and changed texts ship in Spanish and in the Portuguese locale core already has.

### Meeting point with part 2

Part 2 is the «Estado del pedido» card with the stepper. Until then, part 1 keeps the fulfillment actions where they are today:

- **Marcar enviado** and **Marcar entregado**, each with its block reason, stay at the top of the «Entrega» card.
- **Cancelar pedido** stays under the page header, with its confirmation dialog.
- In «Nueva venta», «Marcar como entregado al guardar» stays in the «Entrega» card.

Part 2 adds the card at the top of the right column and moves those three actions into it. Part 1 reserves no space for the card and adds no state. Part 3 adds the new transitions: back to pending, undo delivery and reopen.

## Out of this version

- **«Estado del pedido» card**, its stepper, **Entregar directamente** and the payment hint inside it: part 2.
- **Volver a pendiente**, **Deshacer entrega** and **Reabrir pedido**: part 3.
- **Editing products on mobile. Real risk, flagged to the founder.**
  - Memory de4d23f5 makes item editing on web and on mobile a release gate for orders from chat.
  - Until mobile has it, a seller on the phone has to open the web to fix a wrong item.
  - Trigger: a Todoist task for mobile item editing, which must exist and be done before orders from chat are released. It does not exist yet and is created only if the founder asks. When it exists, it is linked here.
- **Editing products after stock was deducted. Real risk, flagged to the founder.**
  - A fully paid order with the wrong size, not yet shipped, has to be cancelled and recreated, with its payments recorded again on the new order.
  - Trigger: sellers report it, or the measure in Goal shows many cancel-and-recreate cases on deducted orders. It needs a stock restoration path from editing, which today only cancellation has.
- **Aligning web and mobile wording.** After this change, the same order reads «Venta completada», «Enviada» and «Pagada» on web, and «Completado», «Despachado» and «Pagado» on mobile. Trigger: the mobile item-editing task above, which aligns the mobile labels in the same change.
- **Product categories as picker filters** («Disfraces» and «Accesorios» in the mockup): products have no categories ([Products](../products.md)). Trigger: when products get categories.
- **Searching by variant value** («talla»): the catalog search matches product names only. Trigger: when sellers report not finding products by size.
- **Operation number and payer name on a payment row** («Op. 04812733 · de Jorge Gonzalez» in the mockup): payments do not store them. Trigger: a task that adds them to the payment form.
- **Searching saved contacts from «Cliente»:** the customer is typed, as on mobile. Trigger: when sellers ask to reuse customers.
- **Returning a saved delivery to «Entrega por definir»:** core has no operation that clears a delivery. Trigger: when sellers report assigning a delivery by mistake and needing to empty it; meanwhile it is replaced.

## Flow

### New sale

1. Ventas → **Nueva venta** opens the view empty. The title reads «Nueva venta» with the chip «Sin guardar» and the hint «Completa los productos, pagos, cliente y entrega. Todo se puede editar después.». The delivery starts at «Por definir».
2. The seller presses «/» (or **Agregar producto**) and types «príncipe». They press the **M** chip on «Traje de Príncipe Azul» and **Agregar** on «Corona de Príncipe». The picker stays open; **Listo · 2 agregados** closes it. The lines appear in «Productos» with quantity steppers, and the totals update.
3. Optional steps:
   - **Agregar Yape** adds a draft payment prefilled with the balance; the seller types S/ 150.00 instead.
   - The seller types the customer's name and phone.
   - The seller chooses a delivery method and fills it in.
4. **Guardar venta** saves everything in one step. The view becomes «Pedido #1042» at the order's address, focus goes to that heading and «Venta guardada.» is announced. The link becomes active and the header shows the status labels.

### Correcting a saved order

1. The seller opens «Pedido #1042» from the list. Products, customer and delivery are editable fields. **Descartar cambios** and **Guardar cambios** stay disabled until something differs from the saved order.
2. The seller removes the «Talla M» line and adds «Talla L» with the picker, then raises «Disfraz de Deadpool» to 2. The totals and «Saldo pendiente» show the new estimate. The line «Tienes cambios sin guardar.» appears under the header.
3. **Guardar cambios** saves products, customer and delivery together. The result is «Cambios guardados.», or «Cambios guardados. El pedido queda esperando stock.» when the new total is covered and stock is short.
4. Payments are recorded, approved, rejected or voided at once from «Pagos», without **Guardar cambios**.

Alternative paths:

- **Leaving with unsaved changes:** following a link, pressing **Ver ventas** or using the browser's back button asks «¿Descartar los cambios?» with **Descartar cambios** and **Seguir editando**. Closing or reloading the tab shows the browser's own warning. Nothing is kept after discarding; there is no draft.
- **Descartar cambios** on a saved order asks the same question, then returns every field to the saved order.
- **Descartar** on «Nueva venta» asks «¿Descartar esta venta?» with **Descartar venta** and **Seguir editando**, then empties the view. It is disabled while the view is empty.
- **A known rejection on save** keeps every edit on screen with the affected element marked (see When something fails).

## Screens

### Order view (new and saved)

- **Layout.** Two columns on wide screens. On narrow ones a single column in this order: «Productos», «Pagos», «Cliente», «Enlace del pedido», «Entrega».
- **Sticky bar on narrow screens.** Once the header has scrolled out of view, a bottom bar holds the total and the actions. This replaces today's sticky total of «Nueva venta».
  - New sale with products: the total and **Guardar venta**. **Descartar** stays in the header.
  - Saved order with unsaved changes: «Cambios sin guardar», the total, **Descartar cambios** and **Guardar cambios**.
  - Saved order without changes: only the total.
- **Touch targets.** Every control (chips, steppers, remove icons, tabs) has a target of at least 44 px.

### Header

- **Breadcrumb:** Ventas › «Nueva venta», or Ventas › «Pedido #1042».
- **New sale:**
  - Chip «Sin guardar».
  - Actions **Ver ventas**, **Descartar** and **Guardar venta**.
  - **Guardar venta** is disabled until there is at least one product. It shows «Guardando…» while sending.
- **Saved order:**
  - The status labels (see Rules · Header labels).
  - Subtitle «Creado el 30 oct, 09:10 · Registrado por el vendedor», adding «· Venta completada el 31 oct, 16:40» when completed.
  - Actions **Imprimir rótulo**, **Ver ventas**, **Descartar cambios** and **Guardar cambios**. **Guardar cambios** shows «Guardando…» while sending.
- **Invalid fields.** **Guardar venta** and **Guardar cambios** are not disabled by an invalid field (quantity 0, incomplete delivery, half-typed customer, «Marcar como entregado al guardar» without covering payments). Pressing them sends nothing, shows «No se guardó: revisa 1 campo marcado.» under the header and moves focus and scroll to the first invalid field, which carries its own message. Reason: a disabled button gives no way to find a field that may be off-screen.
- **Status line.** Under the header, one line shows the result of the last save or the in-doubt check (see When something fails · Where outcomes appear).
- **Unchanged.** The existing «Esperando stock» / «Descontando stock» notice, the cancel action and its messages.

### Productos

**Header of the card**

- Title, the count «3 productos · 3 unidades», and **Agregar producto** with the «/» hint.
- On a saved order that is not cancelled, the stock state: «Stock descontado» or «Stock pendiente».
- «Esperando stock» and «Descontando stock» are told by the notice under the header, so no stock state is repeated in the card for them.

**Each line (one per variant)**

- Initials, or the product's main photo.
- Name.
- «Talla M · S/ 89.00 c/u»: the combination in web format, or «Variante única» for a product without options.
- The mentioned-price note, when it applies.
- A stepper (**−**, quantity, **+**) and the line subtotal.
- A remove icon whose accessible name names the line: «Quitar Traje de Príncipe Azul, M».
- When the quantity exceeds the shown stock, the line keeps «Disponible: 3. Si lo cobras, el pedido quedará esperando stock.».

**Typed quantity**

- The field accepts whole numbers only; non-digit characters are not entered.
- An empty field or 0 marks the line «Escribe una cantidad de 1 o más.»; saving with it is refused as an invalid field. Leaving the field empty restores the previous quantity.
- Typing 0 never removes the line: removing is the trash icon.
- Above 9999 the line says «Máximo 9999 unidades.» (initial value, adjustable).

**Search row and totals**

- Below the lines, the dashed row «Buscar producto por nombre…» opens the picker.
- Totals:
  - «Subtotal».
  - «Entrega», only when there is a delivery charge.
  - «Pagado».
  - «Total».
  - «Saldo pendiente», or «Exceso recibido: S/ 12.00» when payments exceed the total.
- While there are unsaved changes or no save yet, the totals are an estimate and say «El total final se calcula al guardar con los precios vigentes.».

**States**

- Empty: «Aún no hay productos» with «Pulsa / o Agregar producto para buscar.».
- Locked: the stepper, the remove icons and **Agregar producto** are disabled, and the card shows the note for its state (see Rules · What can change when).

### Floating product picker

**Layout**

- A modal dialog over the page; it fills the screen on widths below 640 px.
- Search field labeled «Buscar producto», then the filters **Todos** and **Con stock**, then the results counter «3 resultados».

**Each product**

- Thumbnail or initials, and the name.
- Its price, or «Desde S/ 45.00» when its variants differ. In that case each chip shows its own price.
- A product without options: «Variante única · 12 en stock» and **Agregar**.
- A product with options: «4 variantes · elige una para agregar» and one chip per active variant.
- Each chip shows the combination, then «5 en stock» or «Sin stock». It adds «✓ 2» when the order already has 2 units of that variant.

**Adding**

- Pressing a chip or **Agregar** adds one unit, or one more if the variant is already in the order.
- A «Sin stock» chip can be added. It is not drawn as disabled: its text keeps a contrast of at least 4.5:1, and «Sin stock» uses the destructive text color plus the words.
- An added «Sin stock» variant shows the stock warning on its line.

**Keyboard and screen reader**

- Focus stays in the search field, which works as a combobox. The highlighted result is the active option, so the seller keeps typing while choosing.
- While nothing is highlighted, ← and → move the caret in the search text. ↓ highlights the first product (↑ the last); from then on ↑ and ↓ move between products and ← and → move between the chips of the highlighted product.
- Typing, deleting or changing a filter clears the highlight, so ← and → go back to the text.
- Enter adds the highlighted chip, or the product itself when it has no options. On a product with options and no chip highlighted, Enter highlights its first chip without adding. With nothing highlighted, Enter does nothing.
- Tab reaches the filters, every chip and **Agregar** as normal buttons, then **Listo**, so mouse and screen-reader users have the same controls.
- Chip accessible name: «M, 5 en stock, 2 en el pedido». A variant not in the order leaves out the last part. A chip with its own price adds it.
- Every addition is announced politely: «Agregado: Traje de Príncipe Azul, M. 2 en el pedido.».
- Footer: «↑ ↓ productos · ← → variantes · Enter agregar · el selector sigue abierto para agregar más», with **Listo · 2 agregados**, or **Listo** when nothing was added. The key hints are hidden on devices without a fine pointer.
- Esc or **Listo** closes the picker. What was added stays, and focus returns to **Agregar producto**.

**States**

- Loading: «Buscando…».
- No results: «No encontramos "príncipe"», with «Prueba con otro nombre o crea el producto en otra pestaña.» and the link «Crear producto en otra pestaña».
- Empty catalog: «Todavía no hay productos», with the same link.
- Error: «No se pudo cargar el catálogo.» with **Reintentar**, keeping the typed search.
- Too many: «Mostrando los primeros 20. Escribe más para afinar la búsqueda.».

**Shortcut**

- «/» opens the picker only when all of these hold: focus is not in a text field, no other dialog is open (payment form, receipt, cancel or discard confirmation), and products are editable.
- **Agregar producto** declares the shortcut to assistive technology (`aria-keyshortcuts="/"`).

### Pagos

**Summary**

- «Sin pagos · necesario para despachar».
- «Pago parcial · falta S/ 148.00».
- «Pagado», or «Pagado · Exceso recibido: S/ 12.00».
- «Pago por revisar» while a report is pending, except on cancelled orders.

**Actions**

- One **Agregar <wallet>** button per wallet of the country's wallet catalog (`shared/wallet-providers`; in Peru **Agregar Yape** and **Agregar Plin**), then **Transferencia bancaria**.
- Shown while the order is not cancelled, has at least one product and the balance is above zero.
- With no products yet, the card says «Agrega productos para registrar pagos.».

**Saved order**

- Each action opens the payment form with the method preset and «Importe recibido» prefilled with the balance. The box «Descontar stock aunque sea un abono parcial» shows under the existing rule.
- Rows, newest first: method and amount, date, and the state badge «Confirmado», «Por revisar», «Rechazado» or «Anulado».
- Each state keeps today's actions:
  - Reported rows: **Ver captura**, **Rechazar**, **Aprobar** and the «Comprobante de pago» dialog.
  - Confirmed rows: **Anular pago**, also on cancelled orders, and **Ver captura** when the payment came from a report.
  - Rejected rows: the reason and **Ver captura**.
  - Voided rows: no actions.
- A saved payment has no remove icon.

**New sale**

- Each action adds a draft row with «Importe recibido» prefilled with the balance at that moment and editable, and the partial stock box under its rule.
- A later product change does not touch an amount already typed.
- Draft rows have **Quitar** until **Guardar venta**.

**Empty:** «Aún no hay pagos registrados.».

### Cliente (opcional)

- Fields «Nombre» and «Celular». The phone has a country selector, Peru by default, as in the checkout.
- Hint: «Escribe su nombre y celular.».
- A name without a phone, or a phone without a name, marks the missing field with «Completa nombre y celular, o deja ambos vacíos.».
- On a saved order with a customer, **Quitar cliente** empties both fields; saving then shows the order as «Público general».
- A WhatsApp order keeps its WhatsApp mark and offers no **Quitar cliente** (see Rules · Customer).
- Cancelled: read-only.

### Enlace del pedido

- **Before saving:** the card is grey. The input «yoyos.pe/p/…» and the copy and WhatsApp buttons are disabled, and a lock icon sits next to «Disponible al guardar».
- **Saved:** the existing card, with the URL, copy, open and the buyer state line.
- **Without a subdomain:** «Elige el link de tu tienda para compartir este pedido.» and **Ir a Apariencia de la tienda**.
- **Cancelled:** «Pedido cancelado».

### Entrega

- **Fulfillment actions (saved order):** **Marcar enviado** and **Marcar entregado** at the top, with their block reasons, until part 2.
- **Method choice:**
  - Tabs **Por definir**, **Domicilio**, **Agencia** and **Recojo en tienda**, showing only the enabled methods.
  - A new sale starts at **Por definir**, which shows «Entrega por definir. Puedes guardar sin entrega y elegirla después.».
  - Choosing a method shows today's fields for it, open, with no **Editar entrega** step.
  - Choosing **Por definir** again before saving discards the half-filled delivery, and the sale saves without delivery.
  - On a saved order that has a delivery, **Por definir** is disabled with «Una entrega guardada se puede cambiar, pero no quitar.».
- **Incomplete delivery:** a method with incomplete required fields marks them, and saving with it is refused as an invalid field. The note says «Completa la entrega o elige Por definir.» on a new sale or on a saved order without a delivery. It says «Completa la entrega o descarta sus cambios.» on a saved order with a delivery.
- **Destinatario:** «Nombre», «Celular» and, for agency, the identity document, plus the box «Igual que el cliente» (see Rules · Delivery).
- **Costo de entrega (interno):** read-only, from the chosen rate.
- **Who chose it:** «Elegida por el comprador» under the method while the delivery is the one the buyer chose in the checkout.
- **No method enabled:** today's text and **Configurar modalidades de entrega**.
- **New sale:** «Marcar como entregado al guardar» with its requirements.
- **Locked:** the fields are disabled with their note (see Rules · What can change when).

### Disabled states

Whatever cannot change is shown disabled, with a one-line note in its card that names the remedy. Nothing the seller expects to find is hidden.

- A button blocked by a rule (for example **Agregar Yape** or **Marcar enviado** with «Guarda o descarta los cambios primero.») stays in the Tab order as `aria-disabled`, with its note linked as its description, so keyboard and screen-reader users reach the reason.
- A note that applies to a whole card (products locked, delivery locked) is visible text in the card, read in order before its controls.

## Rules

### What can change when

| Order | Products | Customer | Delivery | Payments |
| --- | --- | --- | --- | --- |
| Active, delivery pending, stock not deducted and not «Descontando stock» (includes «Esperando stock» and «Stock pendiente») | Editable | Editable | Editable | Add, approve, reject, void |
| Active, delivery pending, «Descontando stock» | Locked: «El stock se está descontando; los productos ya no se pueden cambiar. Para cambiarlos, cancela el pedido y crea una venta nueva.» | Editable | Editable | Same |
| Active, delivery pending, stock deducted | Locked: «El stock de este pedido ya se descontó; los productos ya no se pueden cambiar. Para cambiarlos, cancela el pedido y crea una venta nueva.» | Editable | Editable | Same |
| Shipped | Locked: «El pedido ya se envió; los productos ya no se pueden cambiar.» | Editable | Locked: «La entrega ya salió; no se puede cambiar.» | Same |
| Delivered or completed | Locked: «El pedido ya se entregó; los productos ya no se pueden cambiar.» | Editable | Locked: «El pedido ya se entregó; la entrega no se puede cambiar.» | Same; voiding a payment can return a completed sale to active |
| Cancelled | Read-only | Read-only | Read-only | Only **Anular pago**; pending reports are read-only |

Shipped and delivered orders get no remedy in the note: the goods already left, and corrections there are agreed in the chat.

What core enforces on a product save: the order is active, its delivery pending and its stock not deducted. The «Descontando stock» lock is a screen rule only: it is derived and can appear or vanish while the seller edits, so it does not invalidate a pending edit, and core accepting such a save is harmless (items are replaced under the order lock and the listener then deducts the new items).

### Products of a saved order

| Aspect | Behavior |
| --- | --- |
| Who | Only a seller of the order's company. The buyer cannot change products ([Checkout](../checkout.md)). |
| Operations | Add a variant, remove a line, set a quantity (a whole number from 1 to 9999). Adding a variant already in the order adds to its line. |
| At least one product | The remove icon of the only line is disabled with «Un pedido necesita al menos un producto. Para anularlo, cancela el pedido.». **−** is disabled at 1. |
| Prices | A line already in the order keeps its copied price, name and combination, also when its quantity changes. A new line takes the current catalog price. Example: «Traje · M» saved at S/ 89.00 stays at S/ 89.00 after going from 1 to 2 units, even if the catalog now says S/ 95.00; a new «Traje · L» line takes S/ 95.00. A variant in the order both before and after the save keeps its copied price, even if the seller removed it and added it again on screen; the on-screen estimate also uses the saved price for it. Repricing a kept line to the current catalog price is not possible in this version. |
| Deactivated variant | A line of a variant deactivated later can stay, be lowered or be removed, but its quantity cannot be raised: «Este producto ya no se vende; puedes bajar la cantidad o quitarlo.». The picker never offers it. |
| Totals | Core recalculates subtotals, total and balance on save. The delivery charge does not change because of products. |
| Payments | No payment changes, is voided or is deleted because products change. Payment status is derived again: lowering the total can make the order «Pagada», and raising it can make it «Pago pendiente» again. |
| Overpayment | If confirmed payments exceed the new total, the order is «Pagada» and shows «Exceso recibido: S/ 12.00». It counts as paid for stock deduction, shipping and delivering, so the excess never blocks anything. No refund is recorded; the seller settles it in the chat. |
| Stock | Saving products never deducts or restores stock by itself. If the order is due for deduction after saving, the stock deduction listener attempts it as for any other trigger. The order is due when payments cover the new total, or when a confirmed payment asked to deduct even if partial. With enough stock, the response already shows it deducted. With short stock, the order is left «Esperando stock». Saving is never refused for stock. An order that stops being due (total raised above the payments) shows «Stock pendiente». How the save triggers the listener: to be resolved in implementation. |
| Waiting order | An order «Esperando stock» is editable, because its stock is not deducted. Removing or lowering the short line can make it deductible on save. |
| Buyer confirmation | A buyer-confirmed order keeps its confirmation after a product change. The buyer sees the current products and total on their link, and the seller tells them in the chat. A buyer confirming while the seller saves is already protected: the checkout compares the total the buyer saw (`expectedTotal`) under the order lock, and refuses a confirmation with an outdated total, showing the new one ([Checkout](../checkout.md)). |
| Chat | Chat messages keep their own rules for open orders. A message that changes the products while the seller edits invalidates the pending edit (see Saving). |
| History | Only the latest products are kept; no record of earlier versions. |

### Customer

| Aspect | Behavior |
| --- | --- |
| Data | Name (1 to 120 characters) and phone in international format: both or none. |
| Set, change, clear | Allowed in every state except cancelled. Clearing shows the order as «Público general» in the detail and the list. |
| Copy | The customer is a copy in the order. Changing it does not update any contact. |
| Contact link | Changing the name or phone keeps the order's link to its contact, as the checkout does when the buyer edits their details. A WhatsApp order's customer is the chat contact: its name and phone can be corrected, but **Quitar cliente** is not offered. Reason: the order would lose its contact while the WhatsApp mark and the chat (which come from the chat itself) remain. Orders without a contact (manual and catalog) can be cleared. |
| Buyer's view | On a catalog or checkout order, the buyer sees the seller's version of their name and phone prefilled in the checkout. Clearing the customer of a confirmed order leaves the buyer's read-only details empty on their link; the order stays confirmed. |
| WhatsApp order without name or phone | A chat order starts with its contact and no name or phone. The «Cliente» card shows the WhatsApp mark, empty fields and «Cliente del chat de WhatsApp. Agrega su nombre y celular si los conoces.». Emptying both fields after setting them is allowed: it keeps the contact and returns to this state, so it is not **Quitar cliente**. |
| WhatsApp mark | The mark and the chat link come from the order's chat, not from the customer, so changing the customer never detaches the order from its chat. |

### Delivery

| Aspect | Behavior |
| --- | --- |
| Untouched delivery | A delivery the seller did not change is not sent with **Guardar cambios**. It keeps its rate, price, recipient and author, including «Elegida por el comprador». A quantity change can never fail for a delivery reason. |
| Recipient, address or reference only | Changing only the recipient, the address text, the reference or the identity document keeps the saved rate and price, with no new quotation. How: to be resolved in implementation. |
| Method, district, rate or agency | Changing one of these quotes again. The save can then be refused for price change or rate unavailable (see When something fails). |
| Author | A delivery the seller changed is recorded as set by the seller, and «Elegida por el comprador» disappears. |
| Undefined delivery | A new sale, or a saved order without a delivery, can be saved at **Por definir**. A saved delivery can be replaced but not removed. |
| «Igual que el cliente» on a new sale | Checked by default once a customer is typed. While checked, the recipient's name and phone mirror the customer. Editing a recipient field unchecks it. |
| «Igual que el cliente» on a saved order | Starts from the saved data: checked only if the saved recipient's name and phone equal the customer's (phones compared normalized), as in the checkout. Otherwise it starts unchecked, with the saved recipient. Example: a checkout buyer who checked «Otra persona recibe el pedido» opens unchecked, and nothing about the recipient changes unless the seller edits it. |
| **Quitar cliente** with the box checked | The box unchecks, and the recipient fields keep the last values they mirrored. The delivery stays valid. |
| Locked delivery | Once the delivery is locked, the recipient is frozen. Changing the customer does not change it, and the box is disabled. |

### Saving

| Aspect | Behavior |
| --- | --- |
| New order | **Guardar venta** creates the order in one step, all or nothing, as today: products, draft payments, customer, delivery (or none) and «Marcar como entregado al guardar». Payments never fail for stock. |
| Saved order | **Guardar cambios** sends only what changed among products, customer and delivery, and applies it all or nothing. It sends the final state (lines and quantities, not increments), so repeating it after a doubtful response cannot add twice. |
| Unsaved changes | The view compares the fields with the saved order. Reverting an edit to the saved value removes it: with nothing different, «Tienes cambios sin guardar.» disappears and **Guardar cambios** and **Descartar cambios** go back to disabled. |
| Actions disabled while there are unsaved changes | **Agregar <wallet>**, **Transferencia bancaria**, **Aprobar**, **Marcar enviado**, **Marcar entregado**, **Cancelar pedido** and **Imprimir rótulo** are disabled with «Guarda o descarta los cambios primero.». Reason: the balance, the requirements and the label must be those of the saved order. |
| Actions that stay enabled | **Anular pago**, **Rechazar** and **Ver captura**. They act on the saved order at once. Afterwards the view refreshes the saved payments, totals, payment status and stock state, and keeps every pending edit on screen. |
| What invalidates a pending edit | A change made elsewhere, since the view was loaded or last refreshed, to what the seller is editing: products (a chat message, another tab or seller), the customer (another tab or seller, a buyer confirmation that changed their details), or the delivery (the buyer's checkout, mobile, another tab). Changes of state invalidate only the edits they lock: stock being deducted invalidates pending product edits; shipping or delivery invalidates pending product and delivery edits; cancellation invalidates every edit. A save with only customer or delivery edits succeeds after a deduction, and a save with only customer edits succeeds after shipping or delivery. |
| What does not invalidate it | Any payment change, from anywhere: the seller's own **Anular pago** or **Rechazar** in this view, a payment recorded, approved, rejected or voided from mobile or another tab, a buyer's payment report. The same goes for a buyer confirmation that changed neither customer nor delivery, and for a stock deduction attempt that left the order waiting. These change the balance shown, which refreshes on the next save or reload. They never refuse the seller's save. |
| Detecting it | Core refuses the save when the order changed in an invalidating way. The view never overwrites the other change. How core detects it: to be resolved in implementation. |
| One at a time | While a save, a payment action or a fulfillment action is in flight or in doubt, every save and every immediate action is disabled. |

### Where «Detalles internos» goes

| Item | Destination |
| --- | --- |
| Stock line | Products card header: «Stock descontado» or «Stock pendiente». Waiting and deducting keep the notice under the header and are not repeated. A cancelled order shows no stock line, because its stock is either restored or was never deducted. |
| Seller (user id) | Dropped, because an id means nothing to the seller. The subtitle shows the origin instead. |
| Who set the delivery (user id or buyer) | Dropped as an id. «Elegida por el comprador» shows in «Entrega» while the buyer's choice stands. |
| Internal delivery cost | Already in «Entrega» as «Costo de entrega (interno)»; it stays there. |

In [Orders](../orders.md#order-detail-waiting-for-stock), the table «The stock line in Detalles internos» becomes the products card stock line. Web then uses «Stock descontado» / «Stock pendiente», the same words as mobile.

### Header labels and sales list

| Order | Labels | Icons | Accessible name |
| --- | --- | --- | --- |
| Completed | «Venta completada» | Check | «Estado de la venta: Venta completada» |
| Cancelled | «Pedido cancelado» | Cross | «Estado del pedido: Pedido cancelado» |
| Active | «Pagada» or «Pago pendiente»; «Entregada», «Enviada» or «Entrega pendiente» | Card for payment; truck for delivery | «Estado del pago: Pago pendiente», «Estado de la entrega: Enviada» |

**Shared rules**

- The text is direct, with no «Pago:», «Entrega:» or «Cubierto».
- One icon per dimension, the same in header and list: card, truck, and check or cross. The state shows in the text and in the color (warning for pending, info for shipped, success for paid, delivered and completed, muted for cancelled). Color is never the only signal. The list's Coins, BadgeDollarSign, Send and PackageCheck icons are replaced.

**Sales list**

- The list keeps its compact control: icons that open to show the text, with the text as the control's accessible name and tooltip.
- An active order with a balance reads «Pago pendiente: S/ 148.00», so the amount owed is not lost.
- The buyer-confirmation line under the order number stays as today: «Pendiente de confirmación», «Confirmado por el comprador» ([Checkout](../checkout.md)).
- A completed order shows only «Venta completada».
- A cancelled order shows only «Pedido cancelado», with no payment, balance or delivery label (memory 909e23b8).

**Shipped wording.** The web texts that call shipped «Despachada» or «Despachado» (the delivery status and the list filter «Despachado desde») become «Enviada» and «Enviado desde», matching **Marcar enviado**.

**Origin in the subtitle**

- Manual: «Registrado por el vendedor».
- Catalog: «Pedido desde el catálogo».
- WhatsApp: «Pedido desde WhatsApp».
- The «Desde el catálogo» badge disappears.

## States

There is no new state. The order keeps its three dimensions (payment, stock, delivery) and its derived status ([Orders · Lifecycle](../orders.md#lifecycle)).

«Sin guardar» and «Tienes cambios sin guardar.» are screen conditions, not states, and nothing is stored for them. Existing orders become editable under the table above without any conversion.

## When something fails

### Where outcomes appear

- **Status line.** Success, in-doubt and check messages appear in the status line under the header. They are announced politely. A success line clears with the next edit; in-doubt, check and failure lines stay until they are resolved or the seller leaves the view. On narrow screens the sticky bar repeats the short result («Guardado», «Verificando…»).
- **After a successful save.** Focus goes to the page heading («Pedido #1042»). For **Guardar venta**, this happens once the address has changed to the order. That change replaces the history entry of «Nueva venta», so the browser's back button goes to Ventas and never to an empty «Nueva venta».
- **Known rejection.** It shows an alert under the header, for example «No se guardó: revisa 1 producto marcado.», with a link to the element. Focus and scroll go to the first marked element, which carries its own message next to it.
- **Conflict, stock deducted meanwhile, or state changed meanwhile.** It shows an alert under the header with its remedy button, and focus goes to the alert.
- **Picker additions.** They are announced in the picker (see Screens).

### Outcomes

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| **Guardar venta** succeeds | The saved view of «Pedido #1042» with «Venta guardada.» | Continue editing |
| **Guardar venta**: a variant is no longer available | The line marked «L / Azul ya no está disponible.»; everything else intact | Remove or change the line and save again |
| **Guardar venta** with «Marcar como entregado al guardar» and payments that do not cover the shown total | Treated as an invalid field: nothing is sent, the checkbox is marked «Para marcarlo entregado, los pagos deben cubrir el total.» and gets focus. If core still answers that the payment does not cover the total (prices changed), the same mark, nothing saved | Add a payment or uncheck it, then save |
| **Guardar venta** with «Marcar como entregado al guardar» and short stock | «No hay stock suficiente para uno de los productos.»; nothing saved | Uncheck it and save, or lower the quantity |
| **Guardar venta** or **Guardar cambios**: delivery price changed | The rate marked with «El precio de la entrega cambió a S/ 12.00. Revísalo y guarda de nuevo.»; nothing saved, every edit intact | Review the price and save again |
| **Guardar venta** or **Guardar cambios**: rate or agency no longer available | The delivery marked with «Esa opción de entrega ya no está disponible. Elige otra.»; nothing saved, every edit intact | Choose another option, or (new sale or saved order without delivery) **Por definir**, then save |
| **Guardar venta** not sent (no connection) | «No se pudo guardar la venta. Revisa tu conexión e inténtalo de nuevo.»; form intact | **Guardar venta** again with the same order |
| **Guardar venta** in doubt | «No sabemos si la venta se guardó. Verificando…»; saving and leaving are blocked until the check ends. If the order exists: the saved view with «Venta guardada.». If not: the form intact with **Guardar venta**. Never a second order | Wait |
| **Guardar cambios** succeeds | «Cambios guardados.» or «Cambios guardados. El pedido queda esperando stock.» | Continue |
| **Guardar cambios**: the order changed meanwhile in an invalidating way (see Saving) | «Este pedido cambió mientras lo editabas. Tus cambios siguen aquí; recarga para ver la versión actual.» with **Recargar pedido**, which asks «¿Descartar tus cambios y ver la versión actual?» (**Descartar y recargar** / **Seguir viendo mis cambios**) | Reload and redo the edits |
| **Guardar cambios** with product edits: stock was deducted while editing (restock served, recovery job, a covering payment from mobile) | «El stock se descontó mientras editabas: los productos ya no se pueden cambiar. Tus cambios de cliente y entrega siguen aquí.» The products card returns to the saved products, locked with its note and remedy. The customer and delivery edits stay and **Guardar cambios** stays available for them. Without such edits, the alert says «No hay otros cambios que guardar.» | **Guardar cambios** for customer and delivery; to change products, cancel and create a new sale |
| **Guardar cambios** with product or delivery edits: the order was shipped or delivered meanwhile; or any edit and the order was cancelled meanwhile | «El pedido ya se envió; no se guardaron los cambios.» (or «ya se entregó» / «está cancelado»), edits kept until reloading. After shipping or delivery, when there is also a customer edit, the alert offers **Guardar solo el cliente**, which drops the other edits | **Recargar pedido**, or **Guardar solo el cliente** |
| **Guardar cambios**: a new variant is no longer available, or a raised line was deactivated | The line marked with the reason | Remove or change it, then save |
| **Guardar cambios** not sent | «No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo.», edits intact | **Guardar cambios** again |
| **Guardar cambios** in doubt | «No sabemos si los cambios se guardaron. Verificando…», with saving and the immediate actions blocked until the check ends. If the order already has the changes: «Cambios guardados.». If not: the edits intact with **Guardar cambios**. If it changed otherwise: the conflict row | Wait. Repeating is harmless, because the save sends the same final state |
| The in-doubt check itself fails (no connection) | «No pudimos comprobar si se guardó. Revisa tu conexión y vuelve a comprobar.» with **Comprobar de nuevo**. Saving stays blocked; the edits stay. Leaving asks «Puede que no se haya guardado. ¿Salir igualmente?» (**Salir** / **Quedarme**) | **Comprobar de nuevo** until it answers |
| Payment and fulfillment actions | Today's outcomes and texts ([Orders · Web «Pagos» card](../orders.md#web-pagos-card), fulfillment buttons) | Unchanged |
| Picker cannot load | «No se pudo cargar el catálogo.» with **Reintentar** | Retry; lines already added stay |

A late response from an earlier attempt does not change the screen. Leaving midway follows the discard confirmation, and nothing is recovered afterwards.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller of the company | Everything in the order, including the internal delivery cost | Everything in Rules, following the state table | Change products once stock is deducting or deducted, or after shipping; delete payments; remove a saved delivery |
| Seller of another company | Nothing: the order answers as missing | — | — |
| Buyer with the link | Current products, totals, delivery and payments, as in the checkout | What the checkout allows | Change products; see the internal cost, origin or stock |

## Information that is kept

- **Agreed and copied:** each line's name, combination, SKU and unit price at the moment the line was added; the customer; the delivery snapshot. Later catalog changes do not alter them.
- **Shown current:** stock in the picker, catalog prices for new lines, the wallet catalog of the country, and the order link under the current subdomain.
- **Not kept:** unsaved edits, drafts of a new sale, and previous versions of the products. Only the latest products and customer are stored.
- **Existing orders** keep their data and simply become editable under the rules.

## Vocabulary

- **Venta and pedido:**
  - «Venta» names the seller's act of selling and its result: «Ventas», «Nueva venta», **Guardar venta**, «Venta guardada.», «Venta completada».
  - «Pedido» names the saved record: «Pedido #1042», «Enlace del pedido», «Pedido cancelado», «Pedido desde el catálogo», «Registrado por el vendedor», «Creado el …».
  - The header labels «Pagada», «Entregada» and «Enviada» are the task's own texts and agree with «venta».
- **Order view:** the single screen for «Nueva venta» and «Pedido #N».
- **Product picker:** the floating dialog opened with «/» or **Agregar producto**. Its variant buttons are chips.
- **Unsaved changes:** edits of products, customer or delivery that differ from the saved order and were not yet sent with **Guardar cambios**. On a saved order, payments are never unsaved.
- **Enviado:** the shipped delivery state on web, «Despachado» on mobile until the mobile alignment.

## Closed decisions

| Decision | Why |
| --- | --- |
| Saved payments are never removed; a wrong one is voided with **Anular pago** and recorded again | Founder rule; voiding keeps the history (memory da31218e) |
| Product changes never change, void or reject payments, and never fail for stock | Founder rule: money that arrived is recorded |
| Stock is deducted only by the stock deduction listener, by shipping and by creation with immediate delivery; editing products never deducts or restores stock by itself | Founder rule; a second path would bypass oldest-first |
| An order keeps at least one product | Removing all products is cancelling |
| Lines keep their copied price; new lines take the current price | What was agreed does not change with the catalog |
| One view for creating and reviewing | Founder-approved mockup |
| Payment changes never invalidate a pending edit of products, customer or delivery | They do not touch what the seller is editing, and the seller's own void must not refuse their save |
| An untouched delivery is never re-sent or re-quoted | A product edit must not fail or change price or recipient for a delivery reason |

## Acceptance criteria

All criteria start from order #1042 as saved: «Traje de Príncipe Azul · M» ×1 and «· L» ×1 at S/ 89.00, «Disfraz de Deadpool · M» ×1 at S/ 120.00, total S/ 298.00, Yape S/ 150.00 confirmed without the partial deduction request, stock not deducted, home delivery chosen by the seller with a charge of S/ 0.00 (cost absorbed), customer «Jorge Gonzalez +51 977 909 427» with «Igual que el cliente». Exceptions are stated.

1. Creating a sale and opening #1042 show the same sections in the same order as mockups 01 and 02. «Detalles internos» does not appear.
2. With focus outside a text field, «/» opens the picker with focus in the search. Typing «príncipe» lists «Traje de Príncipe Azul» with chips S «3 en stock», M «5 en stock», L and XL; ← moves the caret in the text. ↓ highlights the product, → highlights S, → highlights M, Enter twice leaves one «M» line with 2 units. The chip shows «✓ 2», its accessible name is «M, 5 en stock, 2 en el pedido», and «Agregado: Traje de Príncipe Azul, M. 2 en el pedido.» is announced. The picker stays open until **Listo · 1 agregado**, and focus returns to **Agregar producto**. No flat list remains.
3. A «Sin stock» chip («Niño») can be added. Its line shows «Disponible: 0. Si lo cobras, el pedido quedará esperando stock.».
4. «/» does nothing while the payment form is open.
5. Before saving, «Enlace del pedido» is grey with «Disponible al guardar» and its buttons do nothing. After **Guardar venta** it shows the order URL, copy works, and focus is on the heading «Pedido #N».
6. A new sale left at **Por definir** saves without delivery. A new sale with **Domicilio** chosen and no address: pressing **Guardar venta** sends nothing, shows «No se guardó: revisa 1 campo marcado.» and moves focus to the address, marked «Completa la entrega o elige Por definir.».
7. On #1042 the seller raises «Disfraz de Deadpool» to 2 and saves. The total is S/ 418.00, the summary reads «Pago parcial · falta S/ 268.00», and the Yape payment is unchanged. The delivery was not re-quoted.
8. With Deadpool M stock 4, the seller removes both «Traje» lines from #1042 and saves. The total is S/ 120.00, the header shows «Pagada», the card «Exceso recibido: S/ 30.00», and the products card «Stock descontado» in the same response. The products are now locked with the stock note and its remedy.
9. Same as 8 with Deadpool M stock 0: the save succeeds with «Cambios guardados. El pedido queda esperando stock.», the notice «Esperando stock» appears, and the products stay editable.
10. On an order with one line, the remove icon is disabled with «Un pedido necesita al menos un producto. Para anularlo, cancela el pedido.». Typing 0 in its quantity shows «Escribe una cantidad de 1 o más.», and pressing **Guardar cambios** focuses that field without sending; leaving the field empty restores 1.
11. On a shipped order, the «Entrega» fields are disabled with «La entrega ya salió; no se puede cambiar.», the products show their note, and the customer can still be changed and saved.
12. With unsaved product changes, **Agregar Yape**, **Marcar enviado** and **Imprimir rótulo** are disabled with «Guarda o descarta los cambios primero.». Raising a quantity and lowering it back to the saved value disables **Guardar cambios** again.
13. With unsaved product changes on #1042, the seller voids the Yape payment. The row shows the badge «Anulado», the balance goes up, the product edits stay on screen, and the next **Guardar cambios** succeeds.
14. A buyer reports a payment from the checkout while the seller edits #1042: **Guardar cambios** succeeds.
15. A chat message changes the products of #1042 while the seller edits it. **Guardar cambios** shows «Este pedido cambió mientras lo editabas…» with focus on the alert, and the edits stay. **Recargar pedido** → **Descartar y recargar** shows the current order.
16. #1042's Yape payment was recorded with «Descontar stock aunque sea un abono parcial» while Deadpool M stock was 0, so it is «Esperando stock». A cancellation of another order holding Deadpool M restocks it while the seller has changed a quantity and the customer's name. **Guardar cambios** shows «El stock se descontó mientras editabas…». The products return to the saved ones, locked, and the new name stays. Pressing **Guardar cambios** again saves the name.
17. Navigating to Ventas with unsaved changes asks «¿Descartar los cambios?». **Seguir editando** keeps the edits; **Descartar cambios** leaves without saving.
18. A **Guardar cambios** whose response is lost shows «No sabemos si los cambios se guardaron. Verificando…» with saving blocked, then the saved result. Pressing it again afterwards does not double any quantity. If the check also fails, the view shows **Comprobar de nuevo**, saving stays blocked, and the edits stay.
19. The seller changes only the reference of a delivery the buyer chose in the checkout, while that option's price has since changed. **Guardar cambios** succeeds with the old price, and «Elegida por el comprador» disappears. Changing only a quantity on that order keeps «Elegida por el comprador».
20. The seller changes the district of #1042's delivery after the rate's price changed. The save is refused with «El precio de la entrega cambió a S/ 12.00. Revísalo y guarda de nuevo.», and the product edits stay.
21. An order whose buyer checked «Otra persona recibe el pedido» opens with «Igual que el cliente» unchecked and the other recipient. Changing the customer's name and saving leaves the recipient unchanged.
22. On a manual order with «Igual que el cliente» checked, **Quitar cliente** unchecks the box, the recipient keeps «Jorge Gonzalez», and saving shows «Público general» in the detail and the list. A WhatsApp order offers no **Quitar cliente**.
23. A confirmed payment row shows **Anular pago** and no remove icon. A reported payment shows **Aprobar**, **Rechazar** and **Ver captura**, as today.
24. A completed sale shows only «Venta completada» in the header and the list. A cancelled order shows only «Pedido cancelado» in both, with no balance. An active, partially paid, shipped order shows «Pago pendiente» and «Enviada» in the header, and «Pago pendiente: S/ 148.00» and «Enviada» in the list's control. Their accessible names include «Estado del pago» and «Estado de la entrega».
25. A new sale with a variant deactivated in another tab is rejected with the line marked «… ya no está disponible.», focus on that line, and everything else intact.
26. With the Portuguese locale, the view, the picker and the labels show Portuguese texts.
27. With only the customer's name changed on #1042, a covering payment recorded from mobile deducts the stock: **Guardar cambios** succeeds and the products card shows «Stock descontado», locked.
28. On narrow screens with no changes, the sticky bar shows only the total; after editing a quantity it shows «Cambios sin guardar», **Descartar cambios** and **Guardar cambios**. After **Guardar venta**, the browser's back button opens Ventas.
29. On a cancelled order, the products card shows no stock line.

## Questions decided by the review gate

Decided on 30/10/2026 by the review gate of the implement-task skill: the UX/UI reviewer and the product reviewer, consolidated by the coordinator. Gate record: round 1 rejected by both (UX/UI 7 blockers, product 3 blockers); round 2 approved by both, with the five answers below unchanged. Pending the founder's confirmation in the pull request.

1. **Can products be changed after the order's stock was deducted?**
   - Answer: no. Products are editable only while the order is active, its delivery is pending and its stock is neither deducted nor deducting, with or without payments. The locked notes state the remedy (cancel and create a new sale).
   - Who decided: product reviewer and UX/UI reviewer.
   - Reason: it keeps a single deduction path, with restoration only through cancellation (founder rule), and gives a stable rule a disabled control can explain.
   - Discarded alternatives:
     - Editing until shipping, with restoration and re-deduction: a new stock path and half-waiting states.
     - Only orders without payments: fails the task's main scenario, an order with an advance.
   - Condition met: the cost (a fully paid order with the wrong size is cancelled and recreated) is flagged as a deferred risk with its trigger in «Out of this version».
2. **On a saved order, how do edits apply?**
   - Answer: products, customer and delivery are saved together with **Guardar cambios**; payments and fulfillment act at once.
   - Who decided: both reviewers.
   - Reason: it matches mockup 02 and keeps the shown balance equal to the saved one.
   - Discarded alternatives:
     - Every action applied at once: one request per tap, with chat and buyer changes interleaving.
     - Payments also waiting for the save: approving and voiding become work that can be lost.
   - Condition met: Rules · Saving defines which actions stay enabled, how they interact with the conflict check, and what does and does not invalidate a pending edit.
3. **Does a buyer confirmation survive a product change?**
   - Answer: yes. The confirmation stays, and the buyer sees the new products and total on the same link.
   - Who decided: both reviewers.
   - Reason: the change was agreed in the chat, and the checkout's `expectedTotal` check already refuses a confirmation with an outdated total.
   - Discarded alternative: resetting the confirmation to pending, which adds a flow without new protection.
4. **Does seller product editing ship on web only in this task?**
   - Answer: yes, web only.
   - Who decided: both reviewers; the coordinator reports the risk to the founder.
   - Reason: the Todoist task excludes mobile, and the core rules are shared, so mobile only adds screens.
   - Discarded alternative: web and mobile together, roughly double the work.
   - Condition: the mobile item-editing task is listed as a deferred risk that must exist and be done before orders from chat are released (memory de4d23f5).
5. **What does part 1 include, given that core cannot edit products or the customer today?**
   - Answer: the new core operations (edit products, set or clear the customer), their tests, and the update of [Orders](../orders.md) and [Checkout](../checkout.md).
   - Who decided: both reviewers.
   - Reason: money and stock rules change, so the task's "no new tests or docs" no longer fits.
   - Discarded alternative: a view with read-only products, which would move the main acceptance criterion to another task.

## Open items and questions

No open questions.

Decided unless objected:
- The picker offers filters **Todos** and **Con stock** only, and searches by product name. The mockup's category filters and its «nombre o talla» placeholder are left out, because products have no categories and search matches names.
- Variant chips use generic wording («4 variantes · elige una para agregar») instead of «tallas», because options are not always sizes.
- A «Sin stock» chip can be added, with the existing stock warning on its line and contrast of at least 4.5:1, because orders may be saved and charged without stock.
- The picker stays open after each addition, as in the mockup and unlike mobile, which closes it.
- The picker uses the combobox model: focus stays in the search, ← → edit the text until ↓ enters the results, then ↑ ↓ move between products and ← → between chips; Enter on a product with options highlights its first chip.
- Payment buttons follow the country's wallet catalog («Agregar Yape», «Agregar Plin» in Peru), plus **Transferencia bancaria**. They replace «¿Te pagaron por fuera? Registrar pago».
- Confirmed payments show **Anular pago** instead of the mockup's trash icon. Draft payments in «Nueva venta» show **Quitar**, and their amount is editable and not re-prefilled when products change.
- Payment rows do not show the operation number or the payer name, because they are not recorded.
- «Cliente» is typed (name and celular) with no contact search, with the hint «Escribe su nombre y celular.» instead of «Busca un cliente existente…».
- The customer can be changed in every state except cancelled, including completed sales. A WhatsApp order's customer can be corrected but not removed.
- Delivery has a **Por definir** tab, selected by default on a new sale (the mockup preselects «Domicilio»). A saved delivery can be replaced but not removed.
- «Venta» is the seller's act of selling and «pedido» the saved record. The subtitle reads «Registrado por el vendedor», not the mockup's «Venta registrada en tienda», because manual sales are not always made in a store.
- An active shipped order shows «Enviada» in the header and the list, besides «Entregada» and «Entrega pendiente». The web's «Despachada» and «Despachado desde» become «Enviada» and «Enviado desde».
- The header and the list share one icon per dimension (card, truck, check or cross), with the state carried by the text and the color. The list keeps its compact control.
- A cancelled order shows only «Pedido cancelado» in the header and the list, with no balance. An active order's list label keeps the balance: «Pago pendiente: S/ 148.00».
- The «Detalles internos» items are redistributed:
  - The stock line goes to the products card («Stock descontado» / «Stock pendiente»).
  - The seller id is dropped.
  - The delivery author shows only as «Elegida por el comprador».
  - The internal cost stays in «Entrega».
- **Imprimir rótulo** stays in the header of the saved order (it is not in the mockup) and is disabled while there are unsaved changes.
- Until part 2, **Marcar enviado** and **Marcar entregado** stay at the top of «Entrega», and **Cancelar pedido** stays under the header.
- Narrow screens keep a sticky bottom bar with the total and the save action. The picker fills the screen below 640 px.
- Typed quantities are whole numbers from 1 to 9999 (initial value, adjustable). An empty field restores the previous value on leaving it.
- Leaving with unsaved changes asks for confirmation, and there is no persistent draft. A save conflict keeps the seller's edits and offers **Recargar pedido**, with a discard confirmation.
- New and changed texts ship in Spanish and Portuguese.
- Save buttons are not disabled by invalid fields: pressing them focuses the first invalid field. Blocked buttons stay focusable as `aria-disabled` with their note as description.
- A WhatsApp order without name or phone shows «Cliente del chat de WhatsApp. Agrega su nombre y celular si los conoces.».
- «Guardar venta» replaces the history entry, so back goes to Ventas.
- The «Descontando stock» product lock is a screen rule; core enforces only active, delivery pending and stock not deducted.
