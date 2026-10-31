# Hide a product: product definition

**Status:** definition ready to implement (closed on 2026-10-31 after the review gate: product and UX/UI approved in round 3; the founder confirms the gate's answers in the final pull request). Defined on 2026-10-31 from the Todoist task [Ocultar producto del catálogo y de la generación de ventas por mensajes](https://app.todoist.com/app/task/6hrqR5xxq2q9hr3V) (6hrqR5xxq2q9hr3V). Today every active product with at least one active variant appears in the [public catalog](../public-catalog.md) and is read by [message-to-order](../message-to-order.md) and [product identification](../image-product-search.md); the only way to withdraw something is to deactivate all its variants ([Products](../products.md)), which also removes it from «Nueva venta», and a product without options cannot be withdrawn at all. This draft replaces the founder decision of 2026-10-16 recorded in [Public catalog · Decisions](../public-catalog.md#decisions) («Every active product appears; no per-product visibility»), in [Public catalog · Rules](../public-catalog.md#rules) («What is shown») and in the repository memory («Public catalog shows every active product without per-product visibility»). The technical design follows in `docs/drafts/ocultar-producto-technical.md`.

## Problem and situation

A seller has products she sells in the store but does not want to offer online: the last two units of a jacket she keeps for a regular customer, a sample, a product whose photos are not ready, last season's stock she sells only in person. Today the catalog shows every product with an active variant, so a buyer opens the brand link from Instagram, adds that jacket to the cart and continues to checkout; and when a buyer asks for it in WhatsApp, Yoyos adds it to the chat order. The seller's only way out is to deactivate every variant, which also takes the product out of «Nueva venta», so she can no longer sell it at the counter and has to reactivate it each time; a product without options cannot even be deactivated. Otherwise she leaves it visible and explains in the chat that it is not available.

## Goal

The seller can hide a product with one switch: a hidden product is not offered to buyers in the catalog and is never added to an order by reading chat messages, while she keeps selling it herself from «Nueva venta», the point of sale and the order editor. Hypothesis: sellers stop deactivating variants to take products off the catalog; it would show in fewer deactivate/activate cycles on the same variants and in hidden products that keep appearing in manual sales.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller editing a product from the phone or the computer | Take a product off the catalog and the chats without losing it for in-person sales | Product form: web (`/products/new`, `/products/:productId`) and mobile (create and product screens) |
| Seller scanning the product list | See at a glance which products buyers cannot see | Product list on web and mobile |
| Seller recording a sale at the counter or editing an order | Keep finding the hidden product | «Nueva venta» (web and mobile), point of sale, order editor picker |
| Buyer who opened the brand link from Instagram or WhatsApp | Not be offered what the store does not sell online | Public catalog (web only) |
| Seller receiving buyer messages on the phone | Not get a hidden product added by Yoyos to a chat order, and know when a buyer asked for one | Message-to-order and its notices; the mobile WhatsApp catalog hint |
| Seller asking an AI assistant about the store | Hear correctly whether a product is in the catalog | [AI assistants](../assistants.md) tools **Buscar productos** and **Ver producto** |

## First-version scope

- One per-product switch, «Ocultar producto», on the product form on web and mobile, when creating and when editing. Off by default: a new product is visible.
- A hidden product leaves, at once for every new read: the public catalog grid, its search, the product page by direct URL and the carts that contain it; the «Apariencia de la tienda» preview cards; the products message-to-order adds from texts, photos (QR and visual search) and pending completions; and the assistants' «En el catálogo» line and customer link.
- A hidden product stays in: the seller's product list (marked «Oculto»), its product page and variants, «Nueva venta» on web and mobile, the point of sale, the order editor picker, printing and every existing order.
- Showing it again (switch off) returns it to the catalog and to message reading for every read after the save, with nothing else to redo.
- Everything goes into one slice, web and mobile together.

### Message reader on `main` and meeting point with the staged reader

This task ships against the message reader on `main` ([message-to-order](../message-to-order.md): one model call per message, text candidates by name search, QR then visual search for photos, outcome `product_not_available` «Producto no disponible»). Its behavior for hidden products is in [Rules](#rules).

The [staged message reader](https://app.todoist.com/app/task/6hv99FVqgMmmJJR3) (design closed, being implemented on `jorgeluis594/lector-de-pedidos-por-mensaje-nueva-arqu`) replaces that reader. It finds products through the catalog search and photo identification, and its text search brings, next to the sellable candidates, the not-sellable "twins" of a named product (today defined as products with no active variant), so a text naming one gets `product_not_available` and a similar sellable product is never added in its place. A hidden product follows the rules below there; the work belongs to whichever of the two tasks merges second, and this task does not build anything inside the staged reader before it exists on `main`. The list is self-contained so it can be read without this document: when this draft closes, the coordinator records it as a comment on the Todoist task [6hv99FVqgMmmJJR3](https://app.todoist.com/app/task/6hv99FVqgMmmJJR3), so the staged reader's side sees it whichever task merges first.

#### Obligations for the staged reader

Context: Todoist 6hrqR5xxq2q9hr3V adds a per-product switch «Ocultar producto». A hidden product is not offered in the public catalog and is never added to an order by reading chat messages, but the seller still sells it from «Nueva venta», the point of sale and the order editor. Whichever of the two tasks merges second makes the staged reader follow these rules:

1. **Text twins:** a hidden product with active variants counts among the not-sellable twins of the text search (`findMentionCandidates`). A text naming it gets `product_not_available` with the hidden-product body «Un cliente pidió Casaca jean, que es un producto oculto. Revisa el chat: puedes agregarlo tú al pedido o mostrarlo de nuevo en Productos.», and a visible look-alike is never added in its place. It is never a sellable candidate. The same-name rule of the twins still applies: a visible product with the same name key as a hidden one wins, and the hidden one is not reported.
2. **Twins in an all-hidden store:** the guard that returns twins only when the company has a product with an active variant counts hidden products too. A store whose products are all hidden still gets the hidden-product notice when a text names one; only a store with no product with an active variant keeps the silent text miss.
3. **Buyer reply:** the suggested reply for `product_not_available` on a hidden product is «La Casaca jean no está disponible por ahora. ¿Te muestro otra opción?» (pt-BR: «A Casaca jean não está disponível no momento. Quer ver outra opção?»), never «Ya no tenemos la Casaca jean…», which is false for a product the store still has.
4. **Raising an item:** an item of a hidden product already in the order cannot be raised by a message: «uno más», and a set above the current quantity («mejor que sean 3» on ×2), change nothing and give `product_not_available` with the hidden-product body. Lowering, removing and a set at or below the current quantity still apply. This departs from the «never requires sellable» rule for quantity changes, for hidden products only; items of a deactivated variant keep that rule.
5. **«Por resolver» points:** a pending of a product that becomes hidden stays a point until its pending ends, as any pending; its remedy («agrégalo desde la web») is true because the seller can add a hidden product by hand.
6. **Undo of a removed item:** undoing a message that removed an item of a hidden product restores it; the refusal «… ya no se vende.» is only for something no longer sold (a deactivated variant or a product without active variants).
7. **Undo of an ended pending:** undoing the message whose completion attempt ended a hidden product's pending restores that pending like any pending; if the product is still hidden, it ends again on its next completion attempt with the hidden-product notice.
8. **Photos (accepted limit, not an obligation):** photo identification has no twins, so a photo of a hidden product without its QR label can match a visible look-alike at 0.8 certainty or more, or get «Producto no reconocido». It stays as on `main` until photo twins exist or Todoist 6hp3GMrxGGqWCfG3 shows the seller how each item was identified.

## Out of this version

- Two separate switches (catalog only, chats only). Trigger: a seller asking to sell a product in chats but not in the catalog, or the reverse.
- A «Ocultos» filter in the product list, and hiding or showing several products at once. Trigger: stores with more than about 50 products asking for it; the «Oculto» mark and the search cover the usual case.
- Hiding a single variant. Not needed: deactivating a variant already exists ([Products](../products.md)).
- Archiving or deleting products (also out of «Nueva venta»). Trigger: its own task; hiding is not archiving.
- Scheduling visibility (hide until a date). Trigger: a seller asking for launches or pre-sales.
- Hiding from an AI assistant tool: the assistants are read-only.
- On `main`, a text that only names a hidden product gets «Producto no reconocido» instead of the hidden-product notice (accepted limit, see [Rules](#rules)). Trigger: the staged reader merges, which brings the not-sellable twins.
- A deactivated variant's QR label keeps «Producto no reconocido» while a hidden product's QR label gets the hidden-product notice. Trigger: the staged reader or a task about deactivated products' notices.
- **Real risk, flagged:** in both readers, a photo of a hidden product without its QR label can be matched to a visible look-alike at 0.8 certainty or more and added to the chat order (a wrong product, so money), or get «Producto no reconocido» while the seller sees the product in her list. Same risk as a deactivated product today. Trigger: photo twins in identification, or Todoist [6hp3GMrxGGqWCfG3](https://app.todoist.com/app/task/6hp3GMrxGGqWCfG3) (showing the seller how each item was identified). The founder decides whether to open a task for photo twins.
- Raising an item of a deactivated variant by a message keeps working on `main`, while raising an item of a hidden product is refused. Trigger: a task about deactivated products in chat orders.

## Flow

1. The seller opens a product (web `/products/:productId`; mobile Productos → the product).
2. She turns on «Ocultar producto». The form now has unsaved changes, like any other field.
3. She presses **Guardar cambios** (web) or **Guardar** (mobile). The save is the product's usual all-or-nothing save; the switch and the button are disabled while it reads «Guardando…».
4. On success the product page shows the usual confirmation (web: «Producto guardado correctamente.»; mobile: the alert «Cambios guardados» with «El producto se actualizó correctamente.») and the switch stays on. If this save left a published catalog with no visible product, the confirmation carries the [last-visible notice](#screens). Back in the list, the product carries «Oculto».
5. From that moment, a buyer loading the catalog no longer sees it; its link shows «Este producto ya no está disponible»; a cart that holds it refuses **Continuar** on that line; and messages read after the save never add it.
6. To show it again, the seller turns the switch off and saves.

Alternative paths:

- **Creating a hidden product:** the switch is on the create form too. Saving opens the new product's page, as every create does (web with «Producto guardado correctamente.»; mobile with no alert, as today), with the switch on; the list shows it with «Oculto». It never appears in the catalog. Creating a hidden product never shows the last-visible notice: it does not take a product away from the catalog.
- **Leaving with the switch changed and unsaved:** the usual «¿Descartar cambios?» applies; nothing is hidden.
- **Save rejected, not sent or in doubt:** the product's usual failure handling ([When something fails](#when-something-fails)); the switch keeps the seller's position on screen and the product keeps its stored visibility until a save succeeds.

## Screens

**Product form, web** (`/products/new` and `/products/:productId`):

- A row with the switch `app/components/ui/switch.tsx`, labelled «Ocultar producto», in the product's main data after «Fotos» and before the Variants card. Under it, always visible: «Si lo ocultas, no aparece en tu catálogo y Yoyos no lo agrega a pedidos desde los chats. Puedes seguir vendiéndolo en Nueva venta.» (pt-BR: «Ocultar produto»; «Se você ocultá-lo, ele não aparece no seu catálogo e o Yoyos não o adiciona a pedidos pelos chats. Você pode continuar vendendo-o em Nova venda.»)
- Accessibility: the label is associated with the switch (clicking it toggles), the hint is the switch's accessible description, Space toggles it from the keyboard, and it is in the tab order between «Fotos» and the Variants card.
- It is part of the form draft: it saves with **Guardar cambios**, counts as a change for the «¿Descartar cambios?» guard and for the browser's leave warning, and is restored by **Descartar**.
- While saving, it is disabled with the rest of the form.
- It is shown the same for products with and without options, and with or without active variants.
- The label always keeps the noun, «Ocultar producto»: the Variants card below has an «Ocultar» / «Ver» button that collapses a list, and «Apariencia de la tienda» has **Ocultar catálogo**. The switch is a different control in a different card, and its label never shortens to «Ocultar».
- The hint stays true when the catalog is not published: «no aparece en tu catálogo» holds, and the chat part still applies, so the seller is not led to think hiding is needed only for a published catalog.

**Product form, mobile** (create screen and product screen):

- The same row, label and hint, with the native switch used by the «Publicar catálogo» card (`catalog-publication-card`), in the form's main fields, after the photo strip and before «Variantes». Touch target at least 44 pt; the accessible name is «Ocultar producto», the hint is its accessibility hint, and the state is announced as on or off.
- Saves with **Guardar**; same discard and disabled rules as web.

**Last-visible notice (web and mobile):** only when a save turns a published catalog from showing at least one product to showing none (the saved product was the last visible product with an active variant), the saved confirmation adds «Tu catálogo publicado se quedó sin productos visibles. Tus clientes verán la tienda vacía.» (pt-BR: «Seu catálogo publicado ficou sem produtos visíveis. Seus clientes verão a loja vazia.»). On web it follows «Producto guardado correctamente.» in the same message; on mobile it is a second paragraph of the body of the «Cambios guardados» alert. It informs; it does not block or ask for confirmation. It is not shown when the catalog is not published, when it was already empty before the save, or when the hidden product had no active variant (the catalog did not change). Accepted: once the seller dismisses it there is no persistent cue besides the «Oculto» marks in the list and the buyer's empty catalog; no banner is added.

**Product list, web and mobile:**

- A hidden product shows the text mark «Oculto» next to its name, with an eye-off icon, never color alone. On web it reuses `app/components/ui/badge.tsx` in its neutral style; on mobile, where the list row has no pill marks, it is a small text mark with the eye-off icon in the existing small secondary text style, on its own line under the stock line of the row's text column, so a long name still wraps and the mark never pushes the price column. Text contrast at least 4.5:1 in light and dark. Its accessible name adds «oculto». pt-BR: «Oculto».
- Order, search, pages and states of the list do not change; a hidden product is found by name and SKU like any other.
- A hidden product without active variants shows both: «Oculto» in the text column (on mobile under the stock line) and «Sin variantes activas» where it is today (on mobile in the price column).

**Product page, web and mobile:** the switch itself shows the state; there is no extra banner.

**Public catalog (buyer):** no new screen and no new text.

- A hidden product is not in the grid, takes no slot of a page and is not found by search. Its product page shows the existing «Este producto ya no está disponible» with **Volver al catálogo**, themed, with 404.
- A store whose products are all hidden shows the existing empty state «Esta tienda todavía no tiene productos publicados», the same as a store with no products, so it reveals nothing. A search there shows the existing «No encontramos productos con "casaca"».
- A cart line of a hidden product shows the existing «Ya no está disponible» and **Continuar** shows «Algunos productos ya no están disponibles. Quítalos para continuar».

**«Apariencia de la tienda» preview:** the **Catálogo** view shows only products the catalog would show, so hidden products are left out. With one or two visible products it shows only those; with none (every product hidden) it shows its existing three sample products and the label «Tema Boutique · Datos de ejemplo», never hidden products.

**«Nueva venta», point of sale and order editor picker:** a hidden product is offered exactly as a visible one, with no mark, and its QR is read at the point of sale. Reason: in a seller-made sale visibility to buyers does not matter.

**Mobile WhatsApp catalog hint:** it counts only visible products for both of its states, and shows the first that applies:

1. The company has no product with an active variant (hidden or not): existing «Aún no tienes productos. Agrégalos para que Yoyos arme pedidos con los mensajes de tus clientes».
2. It has products with an active variant, but all of them are hidden: «Tus productos a la venta están ocultos. Muestra alguno en Productos para que Yoyos arme pedidos con los mensajes de tus clientes» (pt-BR: «Seus produtos à venda estão ocultos. Mostre algum em Produtos para que o Yoyos monte pedidos com as mensagens dos seus clientes»).
3. Some visible product has an active variant, but no current photo of a visible product with an active variant is indexed: existing «Yoyos todavía no puede reconocer fotos de tus productos…».

All three keep **Ir a Productos**. In states 1 and 2, photo and text misses stay silent, as today with no products; in state 3, photo misses stay silent. A store whose only indexed photos belong to hidden products is in state 3, so photo misses stay silent while visual search cannot answer.

**AI assistants:** **Buscar productos** and **Ver producto** say «No está en el catálogo: producto oculto» for a hidden product and never give its customer link. The line keeps the word «producto» so it reads apart from the catalog line «Tu catálogo está oculto: ahora nadie ve tus productos.» that the same answer carries when the store is unpublished. A product both hidden and without active variants says «No está en el catálogo: producto oculto y sin variantes activas». `en_catalogo: "no"` includes hidden products; since a hidden product can have active variants, `en_catalogo: "no"` combined with a variant filter is no longer refused: it matches hidden products with a matching active variant, and the refusal text («Los filtros de variante (valores, precio y stock) solo miran variantes activas, y los productos que no están en el catálogo no tienen ninguna…») is removed. The tool description changes with it: «un producto está en el catálogo si tiene al menos una variante activa» becomes «un producto está en el catálogo si es visible y tiene al menos una variante activa», and «Los filtros de variante … no se combinan con en_catalogo «no»» is removed, so the agent combines them.

## Rules

| Aspect | Behavior |
| --- | --- |
| What hides | The whole product, all its variants. Visibility is per product, not per variant. |
| Default | Visible. Products that exist when this ships stay visible. |
| Who changes it | Any seller user of the company who can edit products, on web or mobile. |
| What a save writes | A product save writes the visibility only when the seller changed the switch in that form since it loaded; otherwise the stored visibility is kept whatever the form shows. Creating always writes it. Reason: a form opened before another device hid the product must not silently show it again when it saves a description typo, and visibility, unlike prices, is buyer-facing. The save model already sends photos only when their list changed, so this follows the same shape. After the save the form shows the stored visibility. |
| When it takes effect | For every read after the save commits: a new catalog page load, a cart refresh or **Continuar**, a message whose reading starts afterwards. A page or a message already being read is not interrupted. |
| Public catalog | «What is shown» becomes: active, visible products with at least one active variant, priced in the company's currency. A hidden product is not listed, not searchable and its URL answers «Este producto ya no está disponible» (404), the same answer as a product that does not exist, so a hidden product is not revealed. |
| Cart in the buyer's browser | The line stays in the cart; a refresh marks it «Ya no está disponible», and **Continuar** with that line and no existing order creates none until the buyer removes it. Same rule as a deactivated variant. |
| Pending catalog order (created by **Continuar**, not yet confirmed) | Keeps working, identical to a deactivated variant: the reopened cart marks the hidden line «Ya no está disponible» on refresh, yet **Continuar** on that unchanged cart returns the existing order, which the buyer confirms and pays. The refresh mark never blocks returning the existing order. The seller settles it in the chat. |
| Shared product links | A link already sent (`https://rosa.yoyos.lat/productos/<id>`) shows «Este producto ya no está disponible» while hidden and works again when shown. |
| Orders already created | Never change: catalog, chat and manual orders that contain the product are shown, edited, paid, shipped and cancelled as before. Their checkout links keep working. |
| Message reading on `main`: what a hidden product is | Not sellable for reading: not a text candidate, not a visual-search candidate, and its QR label matches no sellable variant. For the seller's own paths (point of sale QR, «Nueva venta», order editor) it stays sellable. |
| Message reading: adding | No message adds a hidden product: not by text, QR, visual search, caption or pending completion. |
| Seller notices | A hidden product the reader knows (its QR label, an item of the open order, a pending) gives `product_not_available` with the title «Producto no disponible» and the body «Un cliente pidió Casaca jean, que es un producto oculto. Revisa el chat: puedes agregarlo tú al pedido o mostrarlo de nuevo en Productos.» (pt-BR: «Um cliente pediu Casaca jean, que é um produto oculto. Veja o chat: você pode adicioná-lo ao pedido ou mostrá-lo de novo em Produtos.»). It says «producto oculto», never «catálogo oculto». A deactivated product keeps today's body («…que ya no está a la venta…»). No new notice kind. |
| Accepted limit on `main`: text naming a hidden product | A text that only names a hidden product («quiero la casaca jean en M», the jacket being in neither the order nor a pending) gets «Producto no reconocido» («Un cliente pidió un producto que no encontramos en tu catálogo. Revisa el chat.»), because the reader on `main` is given only sellable candidates. This differs from the founder decision of 2026-10-30 (memory 58977c58: a text naming a product the seller no longer sells gets «Producto no disponible», because «no reconocido» confuses a seller who can see the product). That decision was planned for the discarded reader task and is not on `main`; the staged reader carries it as the not-sellable twins, and hidden products join them there ([meeting point](#message-reader-on-main-and-meeting-point-with-the-staged-reader)). Giving `main`'s reader those twins now would be work in a reader being replaced. The seller's cue meanwhile is the «Oculto» mark in the list. |
| Asymmetry with deactivated variants | After this task, the QR label of a hidden product gives the hidden-product notice, while the QR label of a deactivated variant keeps «Producto no reconocido». Accepted: the hidden case is the one this task touches. For the technical design: this needs a QR lookup that recognizes a hidden product's code, beyond `findSellableVariantsByQrCodes`, which today returns nothing for it. |
| Message reading: items already in the open order | An item of a hidden product added before it was hidden stays. The buyer can lower it, remove it, or set its quantity at or below the current one («mejor que sea 1» on ×2). Raising it is refused: «uno más de la casaca», and a set above the current quantity («mejor que sean 3» on ×2), change nothing and give the hidden-product notice; a variant change is an add and is refused the same way. This departs from the current rule «Removing, lowering or changing the quantity of an item never requires its product to still be sellable» ([message-to-order · Rules](../message-to-order.md#rules)), for hidden products only: an item of a deactivated variant can still be raised on `main`. Reason: the hidden jacket is reserved stock, and a set above the current quantity takes more of it exactly like «uno más». |
| Message reading: pendings | A pending of a product that becomes hidden ends when a message tries to complete it, with the hidden-product notice, as a pending of a product no longer sold does on `main`; it does not come back when the product is shown again. A «listo» left waiting on that pending follows today's rule: the problem wins, no «Pedido #N listo» follows. |
| Message reading: similar products on `main` | The reader on `main` chooses among the visible candidates it is given, so «quiero la casaca jean» could add a visible «Casaca denim» if the reader judges it is what the buyer named, and a photo of the hidden jacket without its QR could match a visible look-alike at 0.8 certainty or more. Same risk as today for a deactivated product on `main`, and accepted. For text the staged reader closes it through the twins; for photos it stays in both readers (real-risk deferral in [Out of this version](#out-of-this-version)). |
| Seller editing a chat order | The order editor picker and mobile editing offer hidden products. A hidden product the seller adds by hand to a chat order stays like any manual item; later messages can lower or remove it, not raise it. |
| «Nueva venta» and point of sale | Unchanged: hidden products are offered and their QR is read. |
| Stock, prices, variants | Hiding changes none of them. Stock is neither reserved nor released. |
| Photos | Hiding does not remove or reindex photos; a shown-again product is recognizable at once. |
| Mobile catalog hint | Counts only visible products for both states, in the order given in [Screens](#screens). |
| Deactivated variants | Independent rule: a visible product with all variants deactivated stays out of the catalog as today; hiding a product does not deactivate anything. |

## States

| State | Meaning | What triggers it | What the seller sees | What the buyer sees |
| --- | --- | --- | --- | --- |
| Visible | Offered in the catalog and readable by message-to-order (if it has an active variant) | Default; switch off and save | No mark | The product, as today |
| Hidden | Not offered to buyers or added by messages; sold by the seller | Switch on and save | «Oculto» in the list; switch on in the form | Nothing; its link shows «Este producto ya no está disponible» |

Transitions: Visible ↔ Hidden, both ways, any number of times, no confirmation. Neither is final. Products created before this feature are Visible.

## When something fails

The switch saves with the product, so it has exactly the product save outcomes of [Products · When something fails](../products.md#when-something-fails).

| Situation | What the seller sees | What she can do |
| --- | --- | --- |
| Success | «Producto guardado correctamente.», plus the last-visible notice when it applies; the switch keeps the saved position; the list shows or drops «Oculto» | Nothing more |
| Known rejection (another field invalid) | Nothing is saved, the visibility included; the switch keeps her position; the error is next to its field | Fix the field and save again |
| Not sent (offline) | «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» with **Reintentar**; the form intact | Retry; nothing changed in the catalog |
| In doubt | The usual in-doubt text with **Recargar producto**; never «guardado». The catalog may or may not already hide it | Reload: the switch shows the stored visibility |
| Product changed by someone else | «Este producto cambió desde que lo abriste…» with **Recargar producto** (only when the structure changed) | Reload and set the switch again |
| Device B saves another field from a form opened before device A hid the product | The product stays hidden: B did not touch the switch, so its save does not write visibility. B's form shows «Ocultar producto» on after the save, with no extra message (accepted; no toast is added) | Nothing |
| The seller toggles the switch and back to its loaded position | Counts as unchanged: the save does not write visibility | — |
| Two devices both change the switch | Last save wins | — |
| Seller leaves with the switch changed | «¿Descartar cambios?»; discarding keeps the stored visibility | Keep editing or discard |

The buyer's failures do not change: a catalog load error still shows **Reintentar**, never an empty catalog, and a failed cart refresh keeps its lines.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller user of the company | Every product, hidden or not, with its mark | Hide and show, sell hidden products manually | — |
| Buyer without an account | Visible products of a published catalog | Browse, cart, **Continuar** | Learn that a hidden product exists: its URL answers exactly like a missing product, and an all-hidden store looks like a store with no products |
| Buyer writing in the chat | — | Ask for any product | Get a hidden product added by Yoyos |
| AI assistant connected by the owner | Every product, with «No está en el catálogo: producto oculto» | Read only | Give the customer link of a hidden product |

The risk the buyer-side rule closes: a hidden product reached by a guessed or old link must not be orderable or reveal that it is only hidden.

## Information that is kept

- Per product, account data: whether it is hidden. Only the current value; when or who hid it is not kept. Where it is stored is to be resolved in implementation.
- Orders keep their copies (name, combination, SKU, price) and are never affected by visibility.
- The buyer's cart keeps its lines in the browser, as today.
- Existing products receive «visible» without seller action; no transition period (no production data yet).
- On promotion of this draft, these permanent statements change: [Products](../products.md) «There is no product deletion, archiving or category. A product with options stops being sold by deactivating all its variants; a product without options cannot be withdrawn.» (hiding now withdraws any product from buyers), its «Deactivating» reason («it is the only way to stop selling a product with options») and «Product without active variants»; [Public catalog](../public-catalog.md) Rules «What is shown» and the Decisions row «Every active product appears; no per-product visibility»; [Message to order](../message-to-order.md) «Product not sellable», «Change quantity» («never requires its product to still be sellable», which gains the hidden-product exception) and the seller-notice texts; [Product identification](../image-product-search.md) QR and candidate rules; [AI assistants](../assistants.md) «En el catálogo» line, the `en_catalogo` definition and its refusal with variant filters; the repository memory ce9ca0b2.

## Vocabulary

- **Producto oculto** («Ocultar producto», «Oculto»): a product the seller sells but does not offer to buyers in the catalog or let Yoyos add from chats. Not to be confused with a **hidden catalog** («Tu catálogo está oculto», **Ocultar catálogo**), which hides the whole store; with a **deactivated variant** («Desactivada»), which is no longer sold anywhere; nor with the «Ocultar» / «Ver» button that collapses a list in the variants card. Texts about a product always say «producto oculto» or «Ocultar producto», never «Ocultar» alone or «catálogo oculto». The interface never says «archivado» or «invisible» for it.

## Closed decisions

| Decision | Why |
| --- | --- |
| One switch covers the catalog and message reading | Both are buyer-initiated sales; the seller's reason to hide one almost always applies to the other. |
| Visibility is per product; variants keep their own active/inactive rule | Deactivating a variant already exists; hiding answers "do not offer this product". |
| Hidden products stay in «Nueva venta», the point of sale and the order editor | The goal is to keep selling it in person; otherwise it would be deactivation. |
| The switch saves with the product form, and a save writes it only when that form changed it | One save model for the product page; a stale form never shows a hidden product again. |
| A hidden product's URL answers like a missing product; an all-hidden store looks empty | The buyer cannot tell hidden from deleted. |
| Pending catalog orders and created orders with a hidden product keep working | Same rule as deactivated variants: what was already agreed is honored and settled in the chat. |
| For message reading a hidden product is not sellable; for the seller it is | The seller's manual actions (picker, «Nueva venta», point of sale, undo) keep it. |
| A known hidden product gives `product_not_available` with a «producto oculto» text; no new notice kind | True text with the remedy; the staged reader inherits it through the same outcome. |
| In the staged reader a hidden product with active variants is a not-sellable text twin | Making it absent there would bring back the silent look-alike the staged reader was built to close for text. Photos stay an accepted limit. |
| A message never raises an item of a hidden product, also by a set above the current quantity | Hidden stock is reserved; only the seller adds more of it. |

## Acceptance criteria

1. The seller opens «Casaca jean» (2 variants, M and L, both active), turns on «Ocultar producto» and presses **Guardar cambios**: the list shows «Casaca jean» with «Oculto»; loading `https://rosa.yoyos.lat/` no longer shows it, searching «casaca» does not find it, and `https://rosa.yoyos.lat/productos/<id>` shows «Este producto ya no está disponible» with status 404.
2. A buyer had «Casaca jean · M» and «Polo básico · S» in the cart before it was hidden; pressing **Continuar** marks the jacket line «Ya no está disponible», shows «Algunos productos ya no están disponibles. Quítalos para continuar» and creates no order; after removing the line, **Continuar** creates the order with the polo only.
3. A buyer pressed **Continuar** with «Casaca jean · M» (pending catalog order #1050) before the product was hidden; reopening the cart shows the line «Ya no está disponible» after the refresh, and pressing **Continuar** on that unchanged cart still returns order #1050 unchanged, which the buyer confirms and pays.
4. The seller opens «Nueva venta» on mobile, searches «casaca» and adds «Casaca jean · L» while it is hidden; the sale is saved and its stock is deducted as usual.
5. On the reader on `main`, with «Casaca jean» hidden, not in order #1023 nor pending, and no other casaca in the catalog, a buyer writes «quiero la casaca jean en M»: the order does not change and the seller gets «Producto no reconocido» («Un cliente pidió un producto que no encontramos en tu catálogo. Revisa el chat.»). On the staged reader, once both tasks are merged, the same message gets «Producto no disponible» with the hidden-product body, and with a visible «Casaca denim» in the catalog nothing is added in its place.
6. With «Casaca jean» hidden, a buyer sends a photo of its printed QR label: nothing is added to the chat order and the seller gets «Producto no disponible» with «Un cliente pidió Casaca jean, que es un producto oculto. Revisa el chat: puedes agregarlo tú al pedido o mostrarlo de nuevo en Productos.».
7. Order #1023 had «Casaca jean · M · ×2» before the product was hidden; the buyer writes «mejor que sea 1»: the item goes to 1. The buyer writes «una más de la casaca»: the item stays at 1 and the seller gets the same notice as in criterion 6. The buyer writes «mejor que sean 3»: the item stays at 1, with the same notice.
8. A buyer sent a photo of «Casaca jean» without a size (pending «Falta la variante»), then the seller hid the product, then the buyer writes «en M, listo»: nothing is added, the pending ends, the seller gets the hidden-product notice and no «Pedido #1023 listo».
9. Chat order #1024 holds only «Polo básico · S · ×1». With «Casaca jean» hidden, the seller opens #1024 in the web order editor and adds «Casaca jean · L» from the picker: it is saved; the buyer then writes «una más de la casaca»: the jacket stays at 1 with the hidden-product notice.
10. At the point of sale on mobile the seller scans the QR label of the hidden «Casaca jean · M»: it is added to the sale as usual.
11. The seller turns «Ocultar producto» off and saves: the jacket appears again in the catalog grid in its usual place (newest first by creation date), its old link opens the product page, and a later «quiero la casaca jean en M» adds it to the chat order.
12. The seller creates «Muestra polo» with «Ocultar producto» on: the new product's page opens with the switch on (web with «Producto guardado correctamente.»), with no last-visible notice; it never appears in the catalog and appears in «Nueva venta».
13. The seller turns the switch on and leaves the page without saving: «¿Descartar cambios?» appears; discarding leaves the product visible.
14. The seller turns the switch on with no connection on mobile and presses **Guardar**: «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» appears, the switch stays on screen, and the catalog still shows the product.
15. The save answer is lost: the form shows the in-doubt notice with **Recargar producto**, never a saved confirmation; reloading shows the switch in its stored position.
16. The seller opened «Casaca jean» on the computer; meanwhile she hid it from the phone; back on the computer she fixes a typo in the description and saves: the jacket stays hidden and the computer's form now shows the switch on.
17. A published store has «Casaca jean» as its only visible product; the seller hides it on web, and on mobile in another store: on web the confirmation adds «Tu catálogo publicado se quedó sin productos visibles. Tus clientes verán la tienda vacía.», and on mobile the «Cambios guardados» alert carries it as a second paragraph; the buyer sees «Esta tienda todavía no tiene productos publicados»; the «Apariencia de la tienda» preview shows its three sample products with «Datos de ejemplo».
18. A store whose products with active variants are all hidden opens the WhatsApp screen on mobile: the hint says «Tus productos a la venta están ocultos. Muestra alguno en Productos para que Yoyos arme pedidos con los mensajes de tus clientes» with **Ir a Productos**, which opens Productos. A store with one visible product without indexed photos and hidden products with indexed photos sees «Yoyos todavía no puede reconocer fotos de tus productos…».
19. On the mobile product list, a hidden product with all variants deactivated shows «Oculto» and «Sin variantes activas».
20. An AI assistant asks **Buscar productos** with `texto: "casaca"` while it is hidden: the product shows «No está en el catálogo: producto oculto» and no «Link para tu cliente». With `en_catalogo: "no"` and `valores: ["M"]`, it is listed with its M variant instead of the refusal.
21. The «Apariencia de la tienda» preview of a store with a hidden product and two visible ones shows only the two visible ones.
22. A store whose products with active variants are all hidden: on `main`, «quiero la casaca jean» sends no notice (text miss with no visible product) while a photo of its QR label gives the hidden-product notice; on the staged reader after both merge, the text gives the hidden-product notice.

## Questions decided by the review gate

1. **When a buyer's message asks for a hidden product, what does the seller get?**
   - **Answer:** on `main`, option 1: no new notice kind; a hidden product the reader knows (QR label, order item, pending) gets `product_not_available` with a true text that says «producto oculto» (never «catálogo oculto») and carries the remedy; a text that only names a hidden product gets «Producto no reconocido», recorded as an accepted limit with precedent 58977c58 cited and justified. In the staged reader, a hidden product with active variants counts among the not-sellable twins of the text search: `product_not_available` with the hidden text, a look-alike never added in its place, done by whichever task merges second together with the buyer reply and the pending-undo rule.
   - **Decided by:** the coordinator, on disagreement between the reviewers. The product reviewer proposed this combination; the UX/UI reviewer preferred option 2 and accepted option 1 only with the precedent stated and the limit recorded; both conditions are met in this document. Both reviewers confirmed the answer in rounds 2 and 3, and the coordinator relayed it as the founder's answer when closing.
   - **Reason:** true texts with a remedy and no new notice kind; the not-sellable twins already exist in the staged reader, so `main`'s reader, which is being replaced, does not take that work.
   - **Discarded:** option 2 on `main`, a notice of its own also for a text that only names the product (work in a reader being replaced); option 3, today's «…que ya no está a la venta…» and «Ya no tenemos…» texts (false for a product the store still sells, and the second is sent to the buyer).

### Gate record

| Round | Product reviewer | UX/UI reviewer |
| --- | --- | --- |
| 1 | Rejected: meeting point with the staged reader built on a wrong premise (twin vs absent) | Rejected: precedent 58977c58 not stated in question 1; all-hidden store undefined |
| 2 | Rejected: a set above the current quantity was not defined as a raise | Approved with two suggestions (mobile confirmation, no persistent cue) |
| 3 | Approved (suggestions applied: criteria order, criterion 9 starting order, note on the QR lookup) | Approved (suggestions applied: mobile «Oculto» placement, last-visible notice only when the catalog becomes empty, toggle back counts as unchanged, criteria order) |

### Routine decisions reviewed by the gate

The gate raised no objection to these in round 3:

- The switch is «Ocultar producto» (on = hidden), off by default, with the hint «Si lo ocultas, no aparece en tu catálogo y Yoyos no lo agrega a pedidos desde los chats. Puedes seguir vendiéndolo en Nueva venta.»; the label never shortens to «Ocultar».
- It sits in the product's main data after the photos and before Variants, on web and mobile, on create and on edit; web reuses the existing switch and mobile the native switch of the «Publicar catálogo» card.
- It saves with **Guardar cambios** / **Guardar**, not at once; unsaved changes to it trigger «¿Descartar cambios?»; a save writes the visibility only when that form changed the switch.
- After create, the new product's page opens with the switch in its saved position, as every create does.
- A save that turns a published catalog from showing products to showing none adds «Tu catálogo publicado se quedó sin productos visibles. Tus clientes verán la tienda vacía.» to the confirmation (web message; mobile «Cambios guardados» alert body); it does not block and leaves no persistent cue once dismissed.
- The list mark is the text «Oculto» with an eye-off icon in the existing neutral badge style; no list filter in this version.
- Hiding needs no confirmation and showing again restores everything at once.
- An all-hidden published store shows the buyer the existing «Esta tienda todavía no tiene productos publicados»; the preview shows its sample products.
- The cart and pending catalog orders follow the deactivated-variant rules: lines marked at refresh and blocked at **Continuar**, while an existing pending order is still returned, confirmed and paid.
- Hidden products are offered with no mark in «Nueva venta», the point of sale and the order editor picker, also when editing a chat order.
- Items of a hidden product already in a chat order can be lowered, removed or set at or below their quantity by messages, never raised: «uno más» and a set above the current quantity are refused with the hidden-product notice, a departure from «never requires sellable» for hidden products only. Pendings of it end on their next completion attempt and do not come back on `main`.
- The hidden-product notice body is «Un cliente pidió Casaca jean, que es un producto oculto. Revisa el chat: puedes agregarlo tú al pedido o mostrarlo de nuevo en Productos.».
- On `main` a visible look-alike may still be chosen, the same accepted risk as today; the staged reader closes it for text through the twins. For photos it stays in both readers, flagged as a real-risk deferral (photo twins or Todoist 6hp3GMrxGGqWCfG3).
- The staged reader follows the «Obligations for the staged reader» list (text twins with the same-name rule, twins also in an all-hidden store, buyer reply, no raising, «Por resolver», both undos), done by whichever task merges second; the coordinator records the list on Todoist 6hv99FVqgMmmJJR3 when this draft closes.
- The mobile WhatsApp hint counts only visible products for both states, in the order: no products → existing text; all products with an active variant hidden → «Tus productos a la venta están ocultos. Muestra alguno en Productos para que Yoyos arme pedidos con los mensajes de tus clientes»; no indexed photo of a visible product → existing text.
- The «Apariencia de la tienda» preview leaves hidden products out.
- The AI assistants say «No está en el catálogo: producto oculto», include hidden products in `en_catalogo: "no"`, define «en el catálogo» as visible with at least one active variant in the tool description, drop the refusal and the description's «no se combinan» with variant filters, and never give their customer link.
- pt-BR texts are given next to each new Spanish text.
- Products that exist when this ships stay visible; no transition.
