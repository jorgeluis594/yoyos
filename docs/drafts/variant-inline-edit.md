# Variant inline editing on mobile: product definition

**Status:** definition ready to implement (approved by the product review gate in round 3, 2026-11-06). Mobile only, plus the restock effect of a seller's stock increase in core. Today a saved variant is edited on its own screen (`/products/[productId]/variants/[variantId]`) and an unsaved one on another (`/products/[productId]/draft-variant`, `/products/new/draft-variant`); the «Variantes» screen holds the list, selection and bulk edits. Since PR #395 the stock of a saved variant is editable in the product editor (per row and in bulk, saved with the product's **Guardar**). This draft complements [Products](../products.md) and [Orders · Stock deduction](../orders.md#stock-deduction), both stale on this point; the implementing PR corrects both. In products.md: the Stock row ("Afterwards users cannot edit it"), Product page ("Stock of saved variants is read-only"), Variants table ("stock (editable only in unsaved rows)", "an inactive row … is edited from its detail"), Bulk editing ("**Editar stock** applies only to new variants…"), Marks ("saved variants are deleted from their detail"), Variant detail (its mobile half), Unsaved variant detail (the mobile screen) and Discard confirmation (opening a saved variant detail). In orders.md: Restock ("Today the only one is the cancellation…") and the known limitation "Sellers cannot increase stock by hand…". Todoist task 6hwfhhCVPqfV7mP3. 2026-11-06.

## Problem and situation

In Yoyos a variant's stock is the units free to sell: a paid order is deducted when it is paid, long before it ships, so its goods are still on the shelf but no longer in the stock. A seller checks the shelf at night: 12 «L / Azul», of which 3 are packed for paid order #1020 that ships tomorrow, so 9 are free, while Yoyos says 10. On the phone she opens the product, goes to «Variantes», taps the row and lands on a separate detail screen where stock is read-only; if she typed anything on the product page first, Yoyos asks to discard it before letting her in. The founder reported that changing a variant's stock from mobile and saving ended in «No se pudo guardar la variante. Revisa los datos e inténtalo otra vez.», which names no field; the exact path is reproduced before any change and stated in the PR. The detail screen also offers **Cambiar combinación**, which the founder decided the seller should not have, and a «Nueva» row opens yet another screen. Three screens for one list, a read-only count where she looks for it, and an error that hides the reason.

## Goal

The seller fixes any variant (sale price, purchase price, SKU, stock, status, label, deletion) from the «Variantes» list without leaving it and without losing pending product edits, and every refusal says which field and why. When she records more free units, the orders waiting for that variant are served. Hypothesis: stock corrections from mobile stop needing the web or two tries, and waiting orders leave «Esperando stock» when the free units are recorded; it would show as variant saves with stock from mobile, the absence of repeated identical attempts after a rejection, and fewer orders waiting for days.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller correcting one variant after counting or repricing, phone in hand | Change the count or price of «L / Azul» and see it saved now | Mobile «Variantes» screen, expanded row |
| Seller adjusting many variants at once | Select by value and apply one price or stock | Mobile «Variantes» screen, selection bar (unchanged) |
| Seller building or restructuring a product | Add combinations, options, removals and save everything together | Mobile product page **Guardar**; web product page **Guardar cambios** |
| Seller with paid orders «Esperando stock» | See them served when she counts more units | The saved message here; the order detail as today |

## Who can do it

Every inline action, stock included, is open to the same company users who edit products today; there is no new permission. The company comes from the session. A variant of another company, or one that does not belong to the product, answers as not existing, as today's per-variant actions do.

## First-version scope

1. Tapping a row of «Variantes» expands that variant's editor inside the list. One row expanded at a time.
2. A saved variant's editor: sale price, purchase price, stock, SKU, QR with **Imprimir etiqueta**, **Desactivar variante** / **Activar variante**, **Eliminar variante** (or the reason it cannot be deleted). Its own **Guardar variante** button saves that variant at once, without navigating and without touching other pending edits. There is no autosave.
3. A «Nueva» row (no server id yet, and every row of a product being created) expands with the same fields; **Aplicar** writes them into the pending product edits, saved with the product's **Guardar**.
4. Stock is a direct value: the seller types or steps the units free to sell, that is, what she has minus what is already deducted for paid orders not yet shipped; no reason, no adjustment amount. A short hint under the field says so. Same control and whole-number validation as today's unsaved-variant editor.
5. Stock of a saved variant is saved per variant by **Guardar variante**: written only when sent, sent only when the seller changed it. The last save wins.
6. A seller's stock increase, inline or through the product save (mobile and web), is a restock: it serves the orders waiting for that variant, oldest first, and the seller is told how many units went to how many orders.
7. Every server rejection of a variant action is explained: next to its field with the reason, or as a message that names the reason. The generic «Revisa los datos» text is gone from every variant flow, and the failure the founder reported no longer happens.
8. **Cambiar combinación** disappears from mobile. Core keeps the operation for installed apps.
9. The saved-variant detail screen and both unsaved-variant screens, with their routes, are removed. Their only entry point is the «Variantes» row itself; no print, notification, order screen, deep link or web page links to them.
10. Everything the list does today is kept: value chips, **Todas**, bulk **Editar precio**, **Editar stock** and **Editar precio de compra**, the counter and the 100-variant limit, uncreated combinations with **Agregar**, removing «Nueva» rows, the copied-stock and inactive-source notices, row errors from the last product save, «Stock total».

## Out of this version

- Web variant detail and its **Cambiar combinación**: unchanged; its stock stays read-only and its **Guardar cambios** still saves only prices and SKU. Web edits stock in its variants table (PR #395). Trigger to revisit: a web redesign of the variants table or sellers asking for stock on the web detail.
- Correcting a wrong combination on mobile: the seller deletes the variant and creates the right one; a printed QR of the deleted variant stops being recognized (founder decision). Trigger: sellers asking to keep labels after a combination mistake.
- Stock history and adjustments with a reason (count, loss, return): not recorded; a stock edit replaces the number. Trigger: the per-variant stock-history feature, which comes next and must not change what the seller does here.
- Protection against simultaneous edits of the same variant (two devices, or a sale between opening and saving): the last save wins. Trigger: sellers reporting counts overwritten by a concurrent edit.
- The stock hint on web stock inputs (variants table, product page): not shown. Trigger: the web variants-table redesign, or sellers recording the shelf count on web.
- Showing how many units are already deducted for paid orders not yet shipped (so the seller can subtract them from the shelf without opening orders): not shown; the hint under **Stock** explains the meaning. Trigger: sellers recording the shelf count by mistake, or the stock-history feature, whichever comes first.
- Choosing which waiting orders a stock increase serves: the existing oldest-first rule applies. Trigger: none planned (orders.md rejects choosing by hand).
- Option and value editing («Opciones»), label printing flow, channel prices: unchanged.
- Products without options: they have no «Variantes» screen; their SKU, prices, stock and QR stay on the product page. Their stock increase through the product save is a restock too.

## Flow

Usual path (saved product, fixing the free units):

1. Product page → **Variantes**. The list shows each row with combination, marks, stock and sale price, and a chevron pointing down (up while the row is expanded).
2. The seller taps «L / Azul». The row expands below its header with the editor prefilled; the list scrolls so the editor is visible above the keyboard, and focus moves to the first field. Any other expanded row collapses. The selection bar, if any, hides while the row is expanded.
3. Under **Stock** she reads «Unidades libres para vender. No cuentes las de pedidos pagados que aún no entregas ni envías.». She has 12 on the shelf and 3 packed for paid order #1020, so she changes **Stock** from 10 to 9 with the stepper or the keyboard. **Guardar variante** becomes enabled.
4. **Guardar variante** → «Guardando…» → «Variante guardada.» inside the editor, announced; the row header and the **Stock** field show «9», and «Stock total» updates. The row stays expanded. #1020 stays deducted and ships as usual.
5. She taps «M / Azul»: «L / Azul» collapses (nothing unsaved, no question) and «M / Azul» expands.

Alternative paths:

- **Increase with waiting orders:** «L / Azul» is at 0 and two paid orders wait for it, #1010 (2 units, older) and #1012 (3 units). She saves 4: #1010 is deducted, #1012 does not fit the 2 left and keeps waiting. The editor says «Variante guardada. Se descontaron 2 unidades para 1 pedido que esperaba stock.», and the row and the **Stock** field show 2.
- **«Nueva» row:** she taps «XL / Azul», sets stock 3 and taps **Aplicar**; the row collapses showing «3 en stock» and the «Nueva» mark, and stays pending until the product's **Guardar**.
- **Rejection:** the editor stays open with what she typed; each refused field shows its reason below it (for example «Este SKU ya lo usa otra variante.»).
- **Offline:** nothing is sent; «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» in the editor, values intact, **Guardar variante** available again.
- **In doubt:** «No se pudo confirmar si se guardó la variante. Recárgala para ver cómo quedó.» with **Recargar variante** in place of **Guardar variante**.
- **Leaving with typed changes:** tapping the row header, another row, **Cancelar** or back asks «¿Descartar cambios?».
- **Pending product edits on the page:** they stay pending; the inline save saves only this variant (see Rules).

## Screens

**«Variantes» (mobile):**

- Collapsed row: checkbox (unchanged), combination, marks as text («Nueva», «Sin guardar», «Desactivada», «Se quitará», «Se eliminará»), stock line («7 en stock» / «Agotado»), sale price and a decorative chevron that points up while expanded. «Sin guardar» uses the warning treatment of the screen's notices (warning text on the warning surface, with at least the app's 4.5:1 contrast), never gray like the other marks and never colour alone; it marks a saved row whose price, purchase price, stock or SKU has a pending product edit (for example a bulk price not yet saved with **Guardar**); «Nueva» rows already say they are unsaved. The row's text except the checkbox is one button; accessible name «Editar L / Azul» (pt «Editar L / Azul»), state expanded or collapsed, and an accessible description that reads the visible marks, stock and price («Sin guardar. 7 en stock. S/ 45.00»), so a screen-reader user hears «Sin guardar» too. A row that cannot expand while another action waits is announced as disabled. The row's error from the last product save stays outside that button and is announced as today.
- Rows marked «Se quitará» or «Se eliminará» do not expand. A «Nueva» row the seller removed herself shows **Deshacer**; a row struck because its value or option is being removed is undone from «Opciones», as today.
- Expanded row (saved variant), top to bottom inside the row card:
  - When the row carries pending product edits: «Esta variante tiene cambios sin guardar del producto. **Guardar variante** los guarda ahora.» The fields show those pending values.
  - When the variant is inactive: «Desactivada: no se vende ni aparece en tu tienda.»
  - Last product-save error of the row, when it has one, next to its field or at the top when it has no field.
  - **Precio de venta** (required), **Costo** (purchase price, optional), **Stock** (stepper with keyboard entry, whole number 0 or more, required) with the hint «Unidades libres para vender. No cuentes las de pedidos pagados que aún no entregas ni envías.» right under it, **SKU** (optional, 100 characters).
  - **Guardar variante** (primary, disabled until a field differs from what is saved) and **Cancelar** (collapses; asks first when something was typed).
  - QR thumbnail with «Este QR identifica la variante en tus etiquetas.» and **Imprimir etiqueta**, which opens the print sheet with this variant selected; with typed or pending changes the sheet warns, as today, that the label prints what is saved.
  - **Desactivar variante** (confirmation, as today) or **Activar variante** (no confirmation).
  - **Eliminar variante** (confirmation naming the values that will disappear, as today), or the first reason it cannot be deleted: orders, then stock, then only variant, judged on the saved values. While the product has pending product edits, the button is replaced by «Guarda o descarta los cambios del producto en la pantalla del producto para eliminar esta variante.».
  - Busy texts on the pressed button: «Guardando…», «Desactivando…», «Activando…», «Eliminando…», «Recargando…» (for **Recargar variante** and **Recargar producto**). While one waits, the editor's other actions and the other rows' expansion are disabled.
- After a successful **Guardar variante** every field shows the answered value; in particular **Stock** shows the answered count (2 when 2 of the 4 typed went to a waiting order), so the field, the header and the sentence agree and **Guardar variante** is disabled again.
- After **Desactivar variante** or **Activar variante** the row stays expanded with «Variante desactivada.» or «Variante activada.», with the same lifetime as «Variante guardada.». After **Eliminar variante** the row disappears and «Variante eliminada.» is announced and shown in a status line pinned under the top bar, outside the scrolling list, so it is visible wherever the list is scrolled (the app has no toast pattern); it stays until the seller's next action, and focus moves to the next row's button, or the previous one, or the list heading.
- Typed, unsaved values and the row's other actions: **Desactivar variante** and **Activar variante** change only the status; the fields keep what she typed, still unsaved, and **Guardar variante** stays enabled. **Eliminar variante** with typed changes first asks «¿Descartar cambios?», because deleting discards them; its blocking reason is always judged on the saved values. **Imprimir etiqueta** keeps the typed values and the print sheet warns, as today, that the label prints what is saved.
- While moving between fields with the keyboard up, the field in focus always stays visible above the keyboard.
- Expanded row («Nueva», or any row of a product being created): **Precio de venta**, **Costo**, **Stock** (empty counts as 0, as today) with the short hint «Unidades libres para vender.» on a product being created, where no order can exist yet, and the full hint on a «Nueva» row of a saved product, **SKU**, «El QR se crea al guardar el producto.», **Aplicar** (writes into the pending product edits, collapses), **Cancelar** and **Quitar** (marks the row «Se quitará» with **Deshacer**). Nothing is sent to the server; the product's **Guardar** saves it.
- Selection while a row is expanded: the checkboxes, chips and **Todas** keep working and do not ask anything, because selecting changes no value. The selection bar is hidden while a row is expanded, so it never covers **Guardar variante**, and comes back with the selection intact when the row collapses. Bulk edits are therefore applied only with no row expanded. Bulk stock applies to saved and new rows (current rule) and stays pending until **Guardar**.
- Header, chips, counter («6 de 100 variantes · 1 desactivada»), notices, uncreated combinations and footer are unchanged.
- States: the screen opens only from the product page, with the product already loaded, so it has no empty or loading state of its own. A variant deleted elsewhere answers «Esta variante ya no existe.» in place of the editor, with **Recargar producto**.
- Back (top bar, Android hardware back and iOS swipe back alike): with typed inline changes asks «¿Descartar cambios?»; discarding drops only the typed inline changes. Pending product edits travel back to the product page as today.
- Return: on coming back to «Variantes» from the product page no row is expanded; selection and scroll position are kept as today.
- Accessibility: expanding moves focus to **Precio de venta**; collapsing returns it to the row's button. «Variante guardada.» (with its restock sentence), the offline, in-doubt and rejection texts are announced once, politely. Stepper buttons, **Guardar variante**, **Cancelar** and the row button keep the app's 44-point minimum touch target.
- Lifetime of «Variante guardada.»: shown until the seller edits any field of the row, starts another action on it, or collapses it. It never stays next to values typed after the save.

**Product page (mobile):** unchanged, except that opening «Variantes» never asks to discard pending edits, and after a **Guardar** whose stock increases served waiting orders the «Cambios guardados» alert adds the restock sentence.

**Product page (web):** unchanged, except that after a save whose stock increases served waiting orders «Producto guardado correctamente.» is followed by the same restock sentence.

**Removed:** the saved-variant detail screen, its route and its **Cambiar combinación** sheet; the unsaved-variant screens and their routes. Nothing in the app links to them besides the rows that now expand.

## Rules

| Aspect | Behavior |
| --- | --- |
| What **Guardar variante** sends | Only the fields of this variant whose value differs from what Yoyos last answered for it. Stock is sent only when the stock field differs from the last stock Yoyos answered. Example: saved 10, seller writes 7 → stock 7 is sent; seller changes only the price → stock is not sent and a sale shipped meanwhile (10 → 9) stays at 9. |
| Meaning of stock | The units free to sell: what the seller has minus the units already deducted for paid orders not yet fulfilled, by shipping, delivery or store pickup alike (deduction happens at payment, not at dispatch or handover). It is not the shelf count. Example: 12 on the shelf, 3 for paid order #1020 not shipped → stock 9. Typing the shelf count would oversell and serve waiting orders with goods that belong to another order. |
| Stock when sent | Replaces the count: whole number, 0 or more, typed as the free units, never as a difference. Same rule as the product save since PR #395. It does not raise the structure version. |
| Empty stock | On a saved row, an empty **Stock** is invalid: «Ingresa un número entero no negativo.» and nothing is sent. On a «Nueva» row it counts as 0, as today. Reason: on a saved row empty would silently write 0 over counted goods. |
| Stock range | No business maximum. The field takes digits only; core's technical bound per variant and for the product total answers with the texts below. |
| One stock operation | Every seller stock write (inline, bulk or row edit through the product save, mobile or web) goes through one operation that behaves the same way, so the coming stock history records all of them without changing this screen. How it is built belongs to the technical design. |
| Increase is a restock | When the new count is higher than the stored one, the increase serves the paid orders «Esperando stock» that contain the variant, oldest first, in the same save, exactly as [Orders · Stock deduction](../orders.md#stock-deduction) defines a restock: each order whose items all fit what is left is deducted; one that does not fit is skipped and keeps waiting. Orders with a pending part (deducted orders whose edit added units that did not fit, shown like waiting) are served the same way: their pending units are deducted when they all fit. The row then shows the answered count, which already excludes the served units. |
| What the seller is told | Only when at least one order was served by this save, after «Variante guardada.» inline or after the product save's success text. `units` counts only the units of the variants this save increased that went to waiting orders; other items of a served order (deducted with it, since an order is deducted whole) are not counted. A pending part served counts like a waiting order: its units of the increased variants go to `units` and the order to `orders`. `orders` counts the distinct orders served, once each even when a product save served one order through several variants. Texts: «Se descontó 1 unidad para 1 pedido que esperaba stock.» / pt «Foi descontada 1 unidade para 1 pedido que aguardava estoque.»; «Se descontaron {{units}} unidades para 1 pedido que esperaba stock.» / pt «Foram descontadas {{units}} unidades para 1 pedido que aguardava estoque.»; «Se descontaron {{units}} unidades para {{orders}} pedidos que esperaban stock.» / pt «Foram descontadas {{units}} unidades para {{orders}} pedidos que aguardavam estoque.». Orders that keep waiting are not named; their detail keeps showing «Esperando stock». |
| Served later | When a waiting order cannot be served in the save itself (its rows are locked elsewhere or the serving budget ran out, orders.md · Known limitations), the units stay free and the recovery job serves it within a minute, while the order shows «Descontando stock». The sentence counts only what this save deducted; serving by recovery is never announced, and the row may show more units than remain a minute later. |
| Decrease | Lowering the count never touches orders already deducted and never returns units to them. Orders still waiting simply keep waiting. |
| Who sets stock | The seller (by count) and orders (deduction, restoration on cancellation or edit), as today. An order arriving after the seller's save deducts from the new count as usual. |
| Simultaneous edits | The last save wins, for stock and every other field. Example: the seller opens «L / Azul» at 10, a shipment takes it to 9, she saves 7 → the variant has 7. |
| Pending edits of the same row | The editor opens with the row's current values, pending ones included. **Guardar variante** saves what the editor shows; afterwards those fields are no longer pending, so the product's **Guardar** does not resend them. **Cancelar** leaves pending values as they were. |
| Pending edits of other rows and of the product | Kept untouched by any inline save, status change or reload. Each row keeps its pending values; rows without a pending value show the latest answered value (for example a stock that a sale or a restock changed). |
| Row error from the product save | Cleared when **Guardar variante** saves, or **Aplicar** applies on a «Nueva» row, a new value for the field it points to, or for the row when it has no field; kept otherwise (an applied «Nueva» row is checked again by the next **Guardar**). |
| Stock hint everywhere on mobile | Every mobile stock input shows the hint: the inline editor, the bulk **Editar stock** sheet and the stock field of the product page of a product without options; the short form on a product being created. Web stock inputs (variants table, product page) do not show it in this version. |
| Pending product edits | Anything the product's **Guardar** would send: name, description, photos, «Ocultar producto», options and values, and list edits (prices, stock and SKU of rows, «Nueva» rows, removals). |
| Activate and deactivate | Saved at once, also with pending product edits. They do not raise the structure version. A deactivated row leaves the selection. |
| Delete | Saved at once after confirmation, and offered only when there are no pending product edits. The deletion conditions (no orders, stock 0, not the only variant) are judged on the saved values, never on a pending bulk value. After a delete the session takes the structure version from the answer, so the next **Guardar** is not refused by the seller's own deletion. Typing stock 0, saving it and then deleting is a deliberate act and allowed: the confirmation already says the QR stops being recognized. |
| Product save after inline actions | The product's **Guardar** keeps its current check and answers «Este producto cambió desde que lo abriste…» when the structure changed since loading. Inline saves and status changes never cause it; an inline delete never does either, because it is only possible without pending edits and the session adopts its answer. |
| One row at a time | Expanding a row collapses the other; a row with typed changes asks first. Only the expanded row renders an editor, whatever the variant count (up to 100). |
| Explicit save | Each row saves with its own button (**Guardar variante** for saved rows, **Aplicar** for «Nueva» rows). Typing never saves. |
| Inactive rows | Expand like active ones; all fields editable, stock included. A stock increase on an inactive variant serves its waiting orders too (orders with an inactive variant keep working). They still cannot be selected for bulk edits. |
| «Nueva» rows | Have no QR, status or deletion: they are edited in the draft and saved by the product's **Guardar**. Their initial stock is not a restock: a new variant has no waiting orders. |
| Combination | Read-only on mobile. A wrong combination is fixed by deleting the variant (when allowed) and adding the right one; the new variant gets a new QR. |
| Validation before sending | Sale price > 0, purchase price ≥ 0 or empty, both with 2 decimals at most and up to 999,999,999.99; stock a whole number ≥ 0 (required on saved rows); SKU up to 100 characters. The same texts as the server reasons below. |
| Parity | Rules, limits and texts match web and core, restock included. Mobile-only, by founder decision: the inline layout, stock in the per-variant save, and the absence of **Cambiar combinación**. The web variant detail keeps read-only stock (see Out of this version). |

### Rejection texts

Every issue the server returns is shown: next to its field when the field is in the editor, otherwise at the top of the editor naming the field. The client chooses the text by field and reason, never by the server's technical message. Core sends a single reason for any sale or purchase price out of range, so each price has one text covering both bounds.

| Field · reason | Text (es) | Text (pt-BR) |
| --- | --- | --- |
| Stock · above core's bound (`INVALID_STOCK` with `maximum`) | «Es demasiado grande. Revisa la cantidad.» | «É grande demais. Revise a quantidade.» |
| Stock · not a whole number ≥ 0 or empty on a saved row (`INVALID_STOCK` without `maximum`, `REQUIRED`, `INVALID_TYPE`) | «Ingresa un número entero no negativo.» (today's stock text, also used before sending) | «Informe um número inteiro não negativo.» |
| Stock · product total above core's bound (`INVALID_TOTAL_STOCK`) | «El stock total del producto supera el máximo permitido. Revisa las cantidades.» next to **Stock** | «O estoque total do produto ultrapassa o máximo permitido. Revise as quantidades.» |
| Precio de venta · out of range (`INVALID_PRICE`) | «Escribe un precio mayor que 0 y de hasta 999,999,999.99.» | «Informe um preço maior que 0 e de até 999.999.999,99.» |
| Costo · out of range (`INVALID_PRICE`) | «Escribe un costo de 0 a 999,999,999.99, o déjalo vacío.» | «Informe um custo de 0 a 999.999.999,99, ou deixe vazio.» |
| Precio de venta / Costo · more than 2 decimals (`INVALID_PRECISION`) | «Usa como máximo 2 decimales.» | «Use no máximo 2 casas decimais.» |
| SKU · too long (`TOO_LONG`) | «Usa como máximo 100 caracteres.» | «Use no máximo 100 caracteres.» |
| SKU · in use (`DUPLICATE_SKU`) | «Este SKU ya lo usa otra variante.» | existing pt text |
| Known field, reason this app version does not know | «No se aceptó este valor. Revísalo e inténtalo otra vez.» next to the field | «Este valor não foi aceito. Revise e tente novamente.» |
| Field the app did not expect (a field not in the editor or not accepted) | «Esta versión de Yoyos envió un dato que ya no se acepta ({{field}}). Actualiza la app e inténtalo otra vez.» at the top | «Esta versão do Yoyos enviou um dado que não é mais aceito ({{field}}). Atualize o app e tente novamente.» |
| Rejection this version does not know, without field | «No se pudo guardar la variante por un motivo que esta versión de Yoyos no reconoce. Actualiza la app e inténtalo otra vez.» | «Não foi possível salvar a variante por um motivo que esta versão do Yoyos não reconhece. Atualize o app e tente novamente.» |

`{{field}}` is the field's visible name when the app knows it («stock», «precio de venta») and only otherwise the name the server gave. The delete and status rejections keep today's texts (orders, stock, only variant). «No se pudo guardar la variante. Revisa los datos e inténtalo otra vez.» and «No se pudo completar la acción. Inténtalo otra vez.» are no longer used by any variant flow.

## When something fails

| Situation | What the seller sees | What she can do |
| --- | --- | --- |
| **Guardar variante** succeeds | «Variante guardada.», plus the restock sentence when orders were served; row header and «Stock total» show the answered values | Keep editing or tap another row |
| Known rejection | Editor intact, each field with its reason (table above); nothing saved and no order served | Correct and save again |
| Not sent (no connection) | «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» Values intact | **Guardar variante** again |
| In doubt (sent, answer lost or server error) | «No se pudo confirmar si se guardó la variante. Recárgala para ver cómo quedó.» Never «Variante guardada.» | **Recargar variante**: reloads, updates only this row's saved values and the editor (asks to discard typed changes first), keeps other pending edits. No other action on this row until then. If the save applied, the waiting orders it served are already deducted, and the stored count is already net of them; the editor never resends an unconfirmed save, and after reloading **Stock** shows the stored count, so typing the same number again is a new save (and, if it is higher than the stored count, serves waiting orders again). Known gap: the restock sentence is not shown after an in-doubt save; reloading shows the resulting count and each order's detail shows its deduction |
| **Recargar variante** / **Recargar producto** fails | «No se pudo recargar. Revisa tu conexión e inténtalo otra vez.»; the row and pending edits stay as they were | Reload again |
| Deactivate offline | «No se pudo desactivar la variante. Revisa tu conexión e inténtalo otra vez.» / pt «Não foi possível desativar a variante. Verifique sua conexão e tente novamente.» | Retry |
| Activate offline | «No se pudo activar la variante. Revisa tu conexión e inténtalo otra vez.» / pt «Não foi possível ativar a variante. Verifique sua conexão e tente novamente.» | Retry |
| Delete offline | «No se pudo eliminar la variante. Revisa tu conexión e inténtalo otra vez.» / pt «Não foi possível excluir a variante. Verifique sua conexão e tente novamente.» | Retry |
| Deactivate / activate / delete in doubt | «No se pudo confirmar el cambio. Recarga la variante para ver su estado.» | **Recargar variante**; repeating has no further effect |
| Delete refused (orders or stock arrived meanwhile, last variant) | Today's reason texts in place of **Eliminar variante** | **Desactivar variante** |
| Variant deleted elsewhere | «Esta variante ya no existe.» in place of the editor | **Recargar producto** (asks to discard pending edits) |
| **Aplicar** on a «Nueva» row with an invalid value | The field's text, row stays expanded | Correct and apply |
| Leaving with typed inline changes | «¿Descartar cambios?» («Se perderán los cambios que no guardaste.», **Descartar** / **Seguir editando**) | Discard or keep editing |
| App closed while a save waits | On return nothing is expanded; the row shows what the server has | Reopen the row and check |

A late answer for a row that was collapsed, or after the seller left the screen, still updates that row's saved values (it is what the server has) but never reopens the row or shows a message.

### Visible texts (es / pt-BR)

Every new or reused text of this feature, besides the rejection and offline texts above. «existing» means the app already has that text in both languages and reuses it.

| Where | es | pt-BR |
| --- | --- | --- |
| Row button | «Editar L / Azul» | «Editar L / Azul» |
| Mark | «Sin guardar» | «Não salva» |
| Stock hint (short form: first sentence only) | «Unidades libres para vender. No cuentes las de pedidos pagados que aún no entregas ni envías.» | «Unidades livres para vender. Não conte as de pedidos pagos que você ainda não entregou nem enviou.» |
| Pending notice | «Esta variante tiene cambios sin guardar del producto. **Guardar variante** los guarda ahora.» | «Esta variante tem alterações do produto não salvas. **Salvar variante** as salva agora.» |
| Inactive notice | «Desactivada: no se vende ni aparece en tu tienda.» | «Desativada: não é vendida nem aparece na sua loja.» |
| Buttons | **Guardar variante**, **Aplicar**, **Cancelar**, **Quitar**, **Imprimir etiqueta**, **Desactivar variante**, **Activar variante**, **Eliminar variante**, **Recargar variante**, **Recargar producto** | **Salvar variante**, **Aplicar**, **Cancelar**, **Remover**, **Imprimir etiqueta**, **Desativar variante**, **Ativar variante**, **Excluir variante**, **Recarregar variante**, **Recarregar produto** |
| Busy | «Guardando…», «Desactivando…», «Activando…», «Eliminando…», «Recargando…» | «Salvando…», «Desativando…», «Ativando…», «Excluindo…», «Recarregando…» |
| Reload failed | «No se pudo recargar. Revisa tu conexión e inténtalo otra vez.» | «Não foi possível recarregar. Verifique sua conexão e tente novamente.» |
| Success | «Variante guardada.», «Variante desactivada.», «Variante activada.», «Variante eliminada.» | «Variante salva.», «Variante desativada.», «Variante ativada.», «Variante excluída.» |
| Restock sentence | See Rules · What the seller is told | See Rules · What the seller is told |
| QR | «Este QR identifica la variante en tus etiquetas.»; «El QR se crea al guardar el producto.» | «Este QR identifica a variante nas suas etiquetas.»; «O QR é criado ao salvar o produto.» |
| Delete blocked by pending edits | «Guarda o descarta los cambios del producto en la pantalla del producto para eliminar esta variante.» | «Salve ou descarte as alterações do produto na tela do produto para excluir esta variante.» |
| Save offline | «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» | «Não foi possível salvar. Verifique sua conexão e tente novamente.» |
| Save in doubt | «No se pudo confirmar si se guardó la variante. Recárgala para ver cómo quedó.» | «Não foi possível confirmar se a variante foi salva. Recarregue-a para ver como ficou.» |
| Action in doubt | «No se pudo confirmar el cambio. Recarga la variante para ver su estado.» | «Não foi possível confirmar a alteração. Recarregue a variante para ver seu estado.» |
| Variant gone | «Esta variante ya no existe.» | «Esta variante não existe mais.» (existing) |
| Discard dialog, delete and deactivate confirmations, delete reasons | existing | existing |

## Information that is kept

- Nothing new is stored by the screen. Typed inline values live only while the row is expanded; pending product edits live in the editing session, as today.
- Stock keeps only the current number; no history of who changed it or why (the stock history comes as its own feature).
- A served order is deducted exactly as by any other restock; it keeps no record of which stock edit served it.
- The variant's QR, orders, status and SKU are unchanged by any stock or price save.

## Vocabulary

- **Guardar variante:** saves one saved variant now. **Guardar** (product page): saves all pending product edits together.
- **Aplicar:** writes a «Nueva» row's values into the pending edits; nothing reaches the server.
- **Cambios sin guardar del producto:** everything the product's **Guardar** would send. A saved row with pending values carries «Sin guardar».
- **Stock:** the units free to sell, excluding units deducted for paid orders not yet shipped; never the shelf count.
- **Restock:** any increase of a variant's stock, now including the seller's; it serves waiting orders oldest first. The interface never says «reposición»; it says how many units went to how many orders.
- **Eliminar** (saved variant, now, with conditions) versus **Quitar** (unsaved row, pending, with **Deshacer**), as today.

## Decisions by the founder

Source for every row: Jorge (founder), 2026-11-06.

| Decision | Detail |
| --- | --- |
| One inline editor replaces both intermediate screens | The saved-variant detail and the unsaved-variant screens collapse into the expanded row of «Variantes». Saved rows save against the server from the row; «Nueva» rows write into the draft and are saved with the product. (Answers former question 2, option 1.) |
| Stock is a direct value | No reason and no adjustments; the same stepper and whole-number validation as today's unsaved-variant editor. |
| Build on PR #395 | Saved-variant stock is already editable through the product save; the per-variant save adds to it without redoing that path. Every seller stock write goes through one operation, so the coming stock history does not change the API. |
| Concurrency out of scope | The last save wins; no version check and no lock on stock. (Answers former question 3, option 1.) |
| Explicit save per row | Each row has its own button; no autosave. |
| The reported failure is fixed | The generic message the founder saw when saving stock is reproduced before changing anything, its cause is stated in the PR, and if saving stock fails on the server today, fixing it is part of this task. |
| docs/products.md is corrected | Where it says saved stock is read-only. |

## Questions decided by the review gate

| Question | Answer | Decided by | Reason | Discarded |
| --- | --- | --- | --- | --- |
| Which number does the seller type in **Stock**? | The units free to sell: what she has minus the units already deducted for paid orders not yet fulfilled (shipping, delivery or pickup). A hint under the field says so; showing the deducted, unshipped units is out of this version | Coordinator, 2026-11-06, from docs/orders.md · Stock deduction and docs/products.md · Stock | Stock is deducted when an order becomes due, at payment, long before dispatch, so the goods of paid unshipped orders are on the shelf but not in the stock | Stock as the shelf count: it would oversell those units and serve waiting orders with goods that belong to another order, which a decrease cannot undo |
| Does a seller's stock increase serve the orders «Esperando stock»? | Yes. Inline and through the product save alike it is a restock: oldest first, in the same save, and the seller is told how many units went to how many orders. A decrease never touches deducted orders. docs/orders.md (Restock and its "sellers cannot increase stock by hand" limitation) is corrected with docs/products.md | Coordinator, 2026-11-06, from docs/orders.md · Stock deduction | orders.md defines a restock as any increase of a variant's stock and requires every use case that increases stock to serve the waiting orders it covers in the same transaction; otherwise goods sit on the shelf while orders wait and newer sales take them first | A seller increase that does not serve waiting orders |
| **Eliminar variante** while the product has pending edits (former question 1) | Delete at once only without pending product edits (anything the product's **Guardar** would send); otherwise the button is replaced by a text pointing to the product screen, and rows with pending values carry «Sin guardar». After a delete the session adopts the answered structure version | Both reviewers (product and UX), round 1 | Keeps the immediate action for the usual case and never loses work; delete is rare and the product's **Guardar** is one back-tap away | (2) a «Se eliminará» mark saved with **Guardar**: one button with two meanings and a refusal moved into the whole save; (3) delete at once and continue on the new version: silently overwrites another device's structural change, which products.md · Concurrency rejects |
| Where does the stock hint appear? | On every mobile stock input: the inline editor, the bulk **Editar stock** sheet and the product page of a product without options (short form «Unidades libres para vender.» on a product being created). Web stock inputs are out of this version | Review gate round 3 (product S2, UX 5), answered by the coordinator | Bulk stock is where a seller would type a shelf count for many rows; the risk of round 2 must not reopen through another door | Hint only in the inline editor; hint on web now (web is out of this task, recorded with its trigger) |
| Does the hint cover only shipments? | No: every paid order not yet fulfilled, by shipping, delivery or store pickup («…que aún no entregas ni envías.») | Review gate round 3 (product S3), answered by the coordinator | Pickup orders are deducted at payment too and their goods stay on the shelf until handed over | A hint naming only shipments |
| Are orders with a pending part (`partial_waiting`) served and counted? | Yes, served by a restock like waiting ones and counted the same way in the sentence | Review gate round 3 (product S4), answered by the coordinator | orders.md has restock retry them; mobile shows them like waiting, so the seller reconciles them the same way | Leaving them to recovery or excluding them from the count |
| What happens to typed, unsaved values on deactivate, activate, delete and print? | Status changes and print keep them unsaved; delete asks «¿Descartar cambios?» first; delete reasons use saved values | Review gate round 3 (UX 2), answered by the coordinator | Never lose typing silently; deleting discards by nature | Resetting fields to saved values after a status change |
| How is «Variante eliminada.» shown in a long scrolled list? | In a line pinned under the top bar, outside the list, until the next action | Review gate round 3 (UX 1), answered by the coordinator | The app has no toast pattern and the deleted row may be far from the top | A line at the top of the scrolling list |

## Closed decisions

| Decision | Why |
| --- | --- |
| Mobile has no **Cambiar combinación**; core keeps the operation | Founder decision; installed apps still call it. Correcting a combination costs the printed QR |
| An inline save never touches other pending edits | The seller must not lose bulk edits or new rows to fix one variant |
| One expanded row, only it renders an editor | Lists reach 100 variants on a phone |
| No server reason is shown as a generic error | The seller cannot correct what she cannot see |
| A seller's stock increase is a restock | orders.md: any increase serves waiting orders oldest first |
| Web variant detail unchanged | Out of this task |

## Acceptance criteria

1. Saved product «Polo» with «L / Azul» at stock 10 and no waiting orders. The seller opens «Variantes», taps «L / Azul», sets stock 7, taps **Guardar variante**: she sees «Variante guardada.», the row says «7 en stock», and after reloading the product and in the mobile catalog the variant has 7. No other screen opened.
2. The failure the founder reported, reproduced as described in the PR, no longer occurs: saving a changed stock of a saved variant from mobile ends in «Variante guardada.» with the new stock stored, and no variant flow shows «No se pudo guardar la variante. Revisa los datos e inténtalo otra vez.».
3. «L / Azul» at 0 with paid orders #1010 (2 units, older) and #1012 (3 units) «Esperando stock». The seller saves 7: both are deducted, the row shows «2 en stock», the editor says «Variante guardada. Se descontaron 5 unidades para 2 pedidos que esperaban stock.», and both orders leave «Esperando stock».
4. Same orders, the seller saves 4: #1010 is deducted, #1012 keeps waiting with «hay 2», the row and the **Stock** field show 2 and the editor says «Variante guardada. Se descontaron 2 unidades para 1 pedido que esperaba stock.».
5. Same orders, the seller raises «L / Azul» to 4 with bulk **Editar stock** and saves with the product's **Guardar** on mobile: #1010 is deducted and the «Cambios guardados» alert adds «Se descontaron 2 unidades para 1 pedido que esperaba stock.». On web the same save shows the sentence after «Producto guardado correctamente.».
6. «L / Azul» at 10 with order #1020 already deducted for 3 units. The seller saves 4: the variant has 4, #1020 stays deducted, nothing is returned and no restock sentence appears.
7. Same product; the seller changes only the price of «L / Azul» to S/ 45.00 while a shipment deducted one unit (10 → 9) after she opened the screen. After saving, the variant has S/ 45.00 and stock 9.
8. Same situation, but she types stock 7: after saving the variant has 7 (last save wins).
9. On a saved row the seller clears **Stock** and taps **Guardar variante**: «Ingresa un número entero no negativo.» appears under **Stock**, nothing is sent and the variant keeps its count. On a «Nueva» row an empty **Stock** applied becomes 0.
10. The seller applied a bulk price of S/ 50.00 to «S / Azul» and «M / Azul» and added a «Nueva» row «XL / Azul», without saving. The two saved rows show «Sin guardar» when collapsed. She expands «L / Azul» and saves stock 7. The two bulk prices and the new row are still pending; **Guardar** on the product page later saves them, and does not change «L / Azul»'s stock.
11. The seller expands «S / Azul» (pending bulk price S/ 50.00, saved S/ 40.00): the editor shows S/ 50.00 with the pending-changes notice; **Guardar variante** saves S/ 50.00, «Sin guardar» disappears, and the product's **Guardar** no longer sends it.
12. The seller taps the «Nueva» row «XL / Azul», sets stock 3 and **Aplicar**: the row collapses with «3 en stock», nothing is sent, and the product's **Guardar** creates it with 3. Typing «2.5» shows «Ingresa un número entero no negativo.» and does not apply.
13. The server refuses a save with a stock issue: «Ingresa un número entero no negativo.» appears under **Stock** with the typed value kept. A refusal for SKU in use shows «Este SKU ya lo usa otra variante.» under **SKU**. A refusal for a field the app does not expect shows the update message naming the field.
14. With no connection, **Guardar variante** shows the connection text and sends nothing; the typed 7 stays.
15. The answer is lost after sending: the editor shows the in-doubt text and **Recargar variante**, never «Variante guardada.»; reloading shows 7 if the save applied, 10 if not, and the bulk prices pending on other rows remain.
16. With «L / Azul» expanded and stock typed but not saved, tapping «M / Azul» asks «¿Descartar cambios?»; **Seguir editando** keeps 7 typed, **Descartar** opens «M / Azul» and «L / Azul» keeps 10. Typing alone never saves.
17. «Variante guardada.» disappears as soon as the seller edits any field of the row again.
18. With three rows selected, expanding «L / Azul» hides the selection bar; tapping a chip while it is expanded changes the selection without asking; collapsing brings the bar back with the selection intact.
19. **Desactivar variante** on «L / Azul» with pending bulk edits on other rows: after confirming, the row shows «Desactivada», leaves the selection, and the pending edits remain.
20. A variant with orders shows «Tiene pedidos, por eso no se puede eliminar…» instead of **Eliminar variante**. One with saved stock 0, no orders and another variant, with no pending product edits, deletes after confirmation and disappears from the list and the counter; the product's next **Guardar** after a rename is accepted.
21. With a pending rename of the product (or a pending bulk price on any row), the same deletable variant shows «Guarda o descarta los cambios del producto en la pantalla del producto para eliminar esta variante.» instead of **Eliminar variante**. A pending bulk stock of 0 on a variant whose saved stock is 5 still shows «Tiene 5 unidades en stock…».
22. «Cambiar combinación» appears on no mobile screen, and no mobile text or test references it. The web variant detail still offers it.
23. No mobile route opens the saved-variant detail or the unsaved-variant screens.
24. Selecting the «Azul» chip and applying **Editar stock** 5 marks every active Azul row with 5 pending, and **Guardar** saves them, as before.
25. A product with 100 variants opens «Variantes» and expands any row without delay; only that row shows an editor.
26. An inactive variant «XL / Rojo» at 0 with paid order #1040 (1 unit) «Esperando stock» expands, accepts stock 3 and saves it: #1040 is deducted, the row shows 2 and the editor says «Variante guardada. Se descontó 1 unidad para 1 pedido que esperaba stock.». It still cannot be selected with **Todas**.
27. With a screen reader, expanding «L / Azul» moves focus to **Precio de venta**, saving announces «Variante guardada.», and collapsing returns focus to the row. A collapsed row with a pending bulk price is read as «Editar L / Azul, Sin guardar. 7 en stock. S/ 50.00».
28. «L / Azul» shows stock 10; paid order #1020 (3 units) is deducted and not shipped, and the shelf has 12. Under **Stock** the hint «Unidades libres para vender. No cuentes las de pedidos pagados que aún no entregas ni envías.» is visible. The seller saves 9: the variant has 9, #1020 stays deducted and ready to ship, and no restock sentence appears.
29. «L / Azul» at 0 and «M / Azul» at 5; paid order #1030 with 1 «L / Azul» and 1 «M / Azul» waits for «L / Azul». The seller saves «L / Azul» at 1: #1030 is deducted whole, «L / Azul» shows 0, «M / Azul» shows 4, and the sentence is «Se descontó 1 unidad para 1 pedido que esperaba stock.» (the «M / Azul» unit is not counted). If instead a product save raises «L / Azul» to 1 and «M / Azul» from 0 to 1 for the same order, the sentence counts 2 units for 1 order.
30. Deleting «S / Rojo» (stock 0, no orders) removes the row, shows and announces «Variante eliminada.» in the line pinned under the top bar and moves focus to the next row. Deactivating «L / Azul» keeps the row expanded with «Variante desactivada.».
31. A per-variant save sent with a variant id of another company, or of another product of the same company, answers as not existing, changes no stock and serves no order of any company.
32. Order #1050 is deducted but an edit added 2 «L / Azul» that did not fit (shown like waiting); «L / Azul» is at 0. The seller saves 2: the pending part is deducted, the row shows 0, and the editor says «Variante guardada. Se descontaron 2 unidades para 1 pedido que esperaba stock.».
33. With stock 7 typed and not saved on «L / Azul», **Desactivar variante** keeps 7 typed and **Guardar variante** enabled; **Eliminar variante** asks «¿Descartar cambios?» first.
34. Typing a stock above core's bound and saving shows «Es demasiado grande. Revisa la cantidad.» under **Stock**.
35. With stock typed on an expanded row, the Android back button and the iOS swipe back ask «¿Descartar cambios?».
36. The bulk **Editar stock** sheet and the stock field of a saved product without options show the full hint; creating a product shows «Unidades libres para vender.» only.
37. A collapsed row with a pending bulk price shows «Sin guardar» in the warning style with at least 4.5:1 contrast; its chevron points up while expanded.
38. **Recargar variante** shows «Recargando…»; offline it shows «No se pudo recargar. Revisa tu conexión e inténtalo otra vez.» and keeps the row as it was.

## Routine decisions confirmed by the review gate

Proposed as «decided unless objected» and accepted without objection by both reviewers (rounds 1 to 3):
- **Guardar variante** saves the values the editor shows, including pending bulk values of that row; afterwards they are no longer pending.
- Inline saves, status changes and reloads keep every other pending product edit; opening «Variantes» never asks to discard.
- Saved rows with pending values carry the text mark «Sin guardar».
- The row stays expanded after a successful save; «Variante guardada.» lasts until the next edit, action or collapse.
- The selection bar hides while a row is expanded; selecting stays possible and never asks.
- Inactive rows expand and accept every field, stock included, but stay out of bulk selection.
- While an action of the expanded row waits, other rows do not expand.
- Empty stock is invalid on saved rows and 0 on «Nueva» rows.
- Stock has no business maximum; core's technical bounds per variant and per product total have their own texts.
- Each price has one out-of-range text covering both bounds, because core sends one reason.
- The stock rejection reuses today's text «Ingresa un número entero no negativo.» / «Informe um número inteiro não negativo.».
- The restock sentence counts only the units of the variants this save increased that went to waiting orders, and each served order once; it does not name the orders that keep waiting nor announce later serving by recovery; web shows it after its product-save success text too.
- The **Stock** hint is a fixed sentence; the deducted, unshipped units are not shown in this version.
- After a save the fields show the answered values, so a stock partly used by waiting orders shows the remaining count in the field.
- After deactivate or activate the row stays expanded with its success text; after delete «Variante eliminada.» stays in a line pinned under the top bar until the next action and focus moves to the next row.
- The collapsed row's accessible description reads its marks, stock and price.
- The pt-BR texts listed under Visible texts, including «Não salva» for «Sin guardar» and «Excluir variante» for «Eliminar variante».
- Unknown server reasons show an «actualiza la app» text naming the field instead of a generic one; texts given in es and pt-BR.
- The removed routes are not redirected: nothing in the app or the web links to them.
- The variant limit is 100 (the contract constant), not 120 as the Todoist task says.
- «Sin guardar» uses the warning treatment of the screen's notices, never gray or colour alone.
- Hardware back and swipe back follow the same discard rule as the top-bar back.
- Reload actions show «Recargando…» and a reload failure keeps the row as it was.
- A stock above core's bound has its own text («Es demasiado grande. Revisa la cantidad.»).
- The chevron points up while the row is expanded.
