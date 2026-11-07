# Variant inline editing on mobile: product definition

**Status:** definition ready for founder review. Mobile only. Today a saved variant is edited on its own screen (`/products/[productId]/variants/[variantId]`) and an unsaved one on another (`/products/[productId]/draft-variant`, `/products/new/draft-variant`). Since PR #395 the stock of a saved variant is editable in the product editor and saved with the product's **Guardar**. Complements [Products](../products.md) and [Orders · Stock deduction](../orders.md#stock-deduction), which the implementing PR corrects (see Closed decisions). Todoist task 6hwfhhCVPqfV7mP3. 2026-11-06.

## Problem and situation

A seller counts «L / Azul» at night and wants to change its stock from 10 to 9 on the phone. She opens the product, goes to «Variantes», taps the row and lands on a separate detail screen where stock is read-only; if she typed anything on the product page first, Yoyos asks to discard it. The founder reported that saving a changed stock from mobile ended in «No se pudo guardar la variante. Revisa los datos e inténtalo otra vez.», which names no field. Three screens for one list, a read-only count where she looks for it, and an error that hides the reason.

## Goal

The seller fixes any variant (sale price, purchase price, SKU, stock, status, deletion) from the «Variantes» list without leaving it and without losing pending product edits, and every refusal says which field and why.

## First-version scope

1. Tapping a row of «Variantes» expands its editor inside the list. One row expanded at a time.
2. Saved row: **Precio de venta**, **Costo**, **Stock**, **SKU**, QR with **Imprimir etiqueta**, **Desactivar variante** / **Activar variante**, **Eliminar variante** (or the reason it cannot be deleted). **Guardar variante** saves that variant at once. No autosave.
3. «Nueva» row (no server id yet, and every row of a product being created): the same fields; **Aplicar** writes them into the pending product edits, saved with the product's **Guardar**.
4. Stock is a direct value: the seller types or steps the new count. No reason, no adjustment amount. Same stepper and whole-number validation as today's unsaved-variant editor.
5. Every server refusal is shown next to its field or as a text that names it. The generic «Revisa los datos» text is gone from every variant flow.
6. The saved-variant detail screen, both unsaved-variant screens, **Cambiar combinación** and their routes are removed from mobile.
7. Everything else the list does today stays: value chips, **Todas**, bulk **Editar precio**, **Editar stock** and **Editar precio de compra**, the counter and the 100-variant limit, uncreated combinations with **Agregar**, removing «Nueva» rows, notices, row errors from the last product save, «Stock total».

## Out of this version

- Restock: a manual stock increase does not serve orders «Esperando stock» yet, exactly as the product save behaves since PR #395. Todoist task 6hwgCJh37mMQ3fRV.
- Stock history and adjustments with a reason: a stock edit replaces the number. Trigger: the per-variant stock-history feature.
- Protection against simultaneous edits of the same variant: the last save wins. Trigger: sellers reporting overwritten counts.
- Web variant detail: unchanged, stock stays read-only there and **Cambiar combinación** stays. Web edits stock in its variants table (PR #395). Correcting a wrong combination on mobile: the seller deletes the variant and creates the right one; the printed QR of the deleted variant stops working.
- Products without options: they have no «Variantes» screen; nothing changes for them.

## Flow

1. Product page → **Variantes**. Each row shows combination, marks, stock and sale price, with a chevron.
2. The seller taps «L / Azul». The row expands with the editor prefilled; any other expanded row collapses.
3. She changes **Stock** from 10 to 9 with the stepper or the keyboard. **Guardar variante** becomes enabled.
4. **Guardar variante** → «Guardando…» → «Variante guardada.» in the editor; the row and «Stock total» show 9. The row stays expanded.
5. She taps «M / Azul»: «L / Azul» collapses (nothing typed, no question) and «M / Azul» expands.

Alternative paths:

- **«Nueva» row:** she taps «XL / Azul», sets stock 3, taps **Aplicar**; the row collapses with «3 en stock» and «Nueva», pending until the product's **Guardar**.
- **Refusal, offline or in doubt:** the editor stays open with what she typed; each refused field shows its reason below it, or a text explains the connection problem and she can save again.
- **Leaving with typed changes:** tapping the row header, another row, **Cancelar** or back asks «¿Descartar cambios?».

## Screens

**«Variantes» (mobile):**

- Collapsed row: checkbox (unchanged), combination, marks as text («Nueva», «Desactivada», «Se quitará», «Se eliminará»), «7 en stock» / «Agotado», sale price, chevron. The row text except the checkbox is one button, accessible name «Editar L / Azul», state expanded or collapsed. Rows marked «Se quitará» or «Se eliminará» do not expand.
- Expanded saved row, top to bottom: «Desactivada: no se vende ni aparece en tu tienda.» when inactive; the row's last product-save error, if any; **Precio de venta**, **Costo**, **Stock** (stepper with keyboard entry), **SKU**; **Guardar variante** (disabled until a field differs from what is saved) and **Cancelar**; QR with **Imprimir etiqueta**; **Desactivar variante** or **Activar variante**; **Eliminar variante** or its blocking reason. When the row has pending product edits (for example a bulk price), the fields show them and **Guardar variante** saves them. **Eliminar variante** is offered only without pending product edits; otherwise its place says «Guarda o descarta los cambios del producto para eliminar esta variante.».
- Expanded «Nueva» row: **Precio de venta**, **Costo**, **Stock** (empty counts as 0), **SKU**, «El QR se crea al guardar el producto.», **Aplicar**, **Cancelar**, **Quitar**. Nothing is sent to the server.
- While an action waits, the pressed button shows «Guardando…», «Desactivando…», «Activando…» or «Eliminando…», and the editor's other actions and the other rows' expansion are disabled. After **Eliminar variante** the row disappears and «Variante eliminada.» is shown under the top bar.
- The selection bar hides while a row is expanded and comes back with the selection intact.
- Back (top bar, Android back, iOS swipe) with typed inline changes asks «¿Descartar cambios?»; pending product edits travel back to the product page as today. Opening «Variantes» from the product page no longer asks to discard pending edits; the product page is otherwise unchanged.
- Accessibility: expanding moves focus to **Precio de venta**; collapsing returns it to the row button. «Variante guardada.» and every refusal text are announced once. Buttons keep the 44-point touch target.

## Rules

| Aspect | Behavior |
| --- | --- |
| What **Guardar variante** sends | Only the fields that differ from what Yoyos last answered for this variant. Example: saved stock 10, she changes only the price → stock is not sent, and a sale shipped meanwhile (10 → 9) stays at 9. |
| Stock | Replaces the count: whole number, 0 or more. No business maximum. Empty on a saved row is invalid («Ingresa un número entero no negativo.») and nothing is sent; empty on a «Nueva» row counts as 0. |
| Stock increase | Does not serve orders «Esperando stock» in this version (Out of this version). A decrease never touches deducted orders. |
| Last save wins | For stock and every other field. Example: she opens «L / Azul» at 10, a shipment takes it to 9, she saves 7 → the variant has 7. |
| Other pending edits | An inline save, status change or delete never discards pending product edits of other rows or of the product. Fields saved inline stop being pending, so the product's **Guardar** does not resend them. |
| Activate and deactivate | Saved at once, also with pending product edits. Typed, unsaved values in the editor stay. |
| Delete | Saved at once after confirmation; offered only without pending product edits. Conditions (no orders, stock 0, not the only variant) are judged on saved values. |
| Combination and inactive rows | The combination is read-only on mobile. Inactive rows expand and accept every field; they are still not selectable for bulk edits. |
| Validation before sending | Sale price > 0, purchase price ≥ 0 or empty, both with at most 2 decimals and up to 999,999,999.99; stock a whole number ≥ 0; SKU up to 100 characters. Same texts as the server refusals below. |

### Refusal texts

The app picks the text by field and reason, never from the server's technical message. Delete and status refusals keep today's texts.

| Field · reason | es | pt-BR |
| --- | --- | --- |
| Stock · `INVALID_STOCK`, `INVALID_TYPE`, `REQUIRED` | «Ingresa un número entero no negativo.» | «Informe um número inteiro não negativo.» |
| Stock · `INVALID_TOTAL_STOCK` | «El stock total del producto supera el máximo permitido. Revisa las cantidades.» | «O estoque total do produto ultrapassa o máximo permitido. Revise as quantidades.» |
| Precio de venta · `INVALID_PRICE` | «Escribe un precio mayor que 0 y de hasta 999,999,999.99.» | «Informe um preço maior que 0 e de até 999.999.999,99.» |
| Costo · `INVALID_PRICE` | «Escribe un costo de 0 a 999,999,999.99, o déjalo vacío.» | «Informe um custo de 0 a 999.999.999,99, ou deixe vazio.» |
| Precio de venta / Costo · `INVALID_PRECISION` | «Usa como máximo 2 decimales.» | «Use no máximo 2 casas decimais.» |
| SKU · `TOO_LONG` | «Usa como máximo 100 caracteres.» | «Use no máximo 100 caracteres.» |
| SKU · `DUPLICATE_SKU` | «Este SKU ya lo usa otra variante.» | existing pt text |
| Known field, unknown reason | «No se aceptó este valor. Revísalo e inténtalo otra vez.» next to the field | «Este valor não foi aceito. Revise e tente novamente.» |
| Unknown field or no field | «Esta versión de Yoyos no reconoce el motivo ({{field}}). Actualiza la app e inténtalo otra vez.» at the top | «Esta versão do Yoyos não reconhece o motivo ({{field}}). Atualize o app e tente novamente.» |

## When something fails

| Situation | What the seller sees | What she can do |
| --- | --- | --- |
| Save succeeds | «Variante guardada.»; row and «Stock total» show the answered values | Keep editing or tap another row |
| Known refusal | Editor intact, each field with its reason | Correct and save again |
| No connection | «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» | Save again |
| In doubt (answer lost or server error) | «No se pudo confirmar si se guardó la variante. Inténtalo otra vez.» Never «Variante guardada.» | Save again: the values replace the stored ones, so repeating is harmless |
| Deactivate / activate / delete offline or in doubt | Today's texts of the detail screen | Retry |
| Variant deleted elsewhere | «Esta variante ya no existe.» with **Recargar producto** | Reload |
| **Aplicar** with an invalid value | The field's text; row stays expanded | Correct |

## Closed decisions

Founder decisions (Jorge, 2026-11-06):

| Decision | Detail |
| --- | --- |
| One inline editor replaces both intermediate screens | Saved rows save against the server from the row; «Nueva» rows write into the draft and are saved with the product. |
| Stock is a direct value | No reason, no adjustments; today's stepper and whole-number validation. |
| Build on PR #395 | Saved stock is already editable through the product save. Every seller stock write goes through one application operation, so a future stock history does not change the API. |
| Concurrency out of scope | Last save wins; no version, no lock. |
| Explicit save per row | Own button per row; no autosave. |
| The reported failure is fixed | Its cause is reproduced in the technical draft (section 3.1). |
| No restock in this task | A manual increase serves no waiting order and publishes no event (Todoist 6hwgCJh37mMQ3fRV). |
| Docs are corrected | `docs/products.md` where it says saved stock is read-only and describes the mobile detail screens; `docs/orders.md` where it says sellers cannot increase stock by hand: they can, and such an increase does not serve waiting orders yet (6hwgCJh37mMQ3fRV). |

Other closed decisions: mobile has no **Cambiar combinación** (core keeps the operation for installed apps); one expanded row and only it renders an editor (lists reach 100 variants); the web variant detail is unchanged.

## Acceptance criteria

1. «L / Azul» at 10: the seller expands it, sets stock 7, taps **Guardar variante**: «Variante guardada.», the row shows «7 en stock», and reloading the product shows 7. No other screen opened.
2. The failure the founder reported no longer happens: saving a changed stock of a saved variant ends in «Variante guardada.», and no variant flow shows «No se pudo guardar la variante. Revisa los datos…».
3. «L / Azul» at 0 with a paid order «Esperando stock»: saving 4 stores 4 and the order keeps waiting.
4. She changes only the price to S/ 45.00 while a shipment took stock 10 → 9: the variant has S/ 45.00 and 9.
5. Clearing **Stock** on a saved row and saving shows «Ingresa un número entero no negativo.» and sends nothing.
6. With a bulk price pending on «S / Azul» and a «Nueva» row pending, saving «L / Azul» keeps both pending; the product's **Guardar** later saves them and does not resend «L / Azul». «S / Azul» with a pending bulk price S/ 50.00 expands showing 50.00; **Guardar variante** saves it and the product's **Guardar** no longer sends it.
7. «XL / Azul» («Nueva»): stock 3 → **Aplicar** collapses with «3 en stock», nothing sent; «2.5» shows «Ingresa un número entero no negativo.».
8. A server refusal `INVALID_STOCK` shows its text under **Stock**; `INVALID_PRECISION` on the sale price shows «Usa como máximo 2 decimales.»; `DUPLICATE_SKU` shows «Este SKU ya lo usa otra variante.». Offline, **Guardar variante** shows the connection text and keeps the typed values.
9. With typed stock, tapping another row, **Cancelar**, Android back or iOS swipe asks «¿Descartar cambios?».
10. **Desactivar variante** with pending bulk edits on other rows keeps them pending.
11. With a pending product rename, **Eliminar variante** is replaced by the pending-edits text; without pending edits a deletable variant is deleted and «Variante eliminada.» appears.
12. No mobile screen shows «Cambiar combinación» and no mobile route opens the variant detail or the draft-variant screens.
13. A product with 100 variants expands any row without delay; only that row renders an editor.
