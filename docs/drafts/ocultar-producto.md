# Hide a product: product definition

**Status:** draft with open questions. Defined on 2026-10-31 from the Todoist task [Ocultar producto del catálogo y de la generación de ventas por mensajes](https://app.todoist.com/app/task/6hrqR5xxq2q9hr3V) (6hrqR5xxq2q9hr3V). Today every active product with at least one active variant appears in the [public catalog](../public-catalog.md) and is read by [message-to-order](../message-to-order.md) and [product identification](../image-product-search.md); the only way to withdraw something is to deactivate all its variants ([Products](../products.md)), which also removes it from «Nueva venta». This draft replaces the founder decision of 2026-10-16 recorded in [Public catalog · Decisions](../public-catalog.md#decisions) («Every active product appears; no per-product visibility»), in [Public catalog · Rules](../public-catalog.md#rules) («What is shown») and in the repository memory («Public catalog shows every active product without per-product visibility»). The technical design follows in `docs/drafts/ocultar-producto-technical.md`.

## Problem and situation

A seller has products she sells in the store but does not want to offer online: the last two units of a jacket she keeps for a regular customer, a sample, a product whose photos are not ready, last season's stock she sells only in person. Today the catalog shows every product with an active variant, so a buyer opens the brand link from Instagram, adds that jacket to the cart and continues to checkout; and when a buyer sends a photo of something similar in WhatsApp, Yoyos may add that product to the chat order. The seller's only way out is to deactivate every variant, which also takes the product out of «Nueva venta», so she can no longer sell it at the counter and has to reactivate it each time, or she leaves it visible and explains in the chat that it is not available.

## Goal

The seller can hide a product with one switch: a hidden product is not offered to buyers in the catalog and is never added to an order by reading chat messages, while she keeps selling it herself from «Nueva venta», the point of sale and the order editor. Hypothesis: sellers stop deactivating variants to take products off the catalog; it would show in fewer deactivate/activate cycles on the same variants and in hidden products that keep appearing in manual sales.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller editing a product from the phone or the computer | Take a product off the catalog and the chats without losing it for in-person sales | Product form: web (`/products/new`, `/products/:productId`) and mobile (create and product screens) |
| Seller scanning the product list | See at a glance which products buyers cannot see | Product list on web and mobile |
| Seller recording a sale at the counter or editing an order | Keep finding the hidden product | «Nueva venta» (web and mobile), point of sale, order editor picker |
| Buyer who opened the brand link from Instagram or WhatsApp | Not be offered what the store does not sell online | Public catalog (web only) |
| Seller receiving buyer messages on the phone | Not get a hidden product added by Yoyos to a chat order | Message-to-order and its notices |
| Seller asking an AI assistant about the store | Hear correctly whether a product is in the catalog | [AI assistants](../assistants.md) tools **Buscar productos** and **Ver producto** |

## First-version scope

- One per-product switch, «Ocultar producto», on the product form on web and mobile, when creating and when editing. Off by default: a new product is visible.
- A hidden product leaves, at once for every new read: the public catalog grid, its search, the product page by direct URL and the carts that contain it; the «Apariencia de la tienda» preview cards; the products message-to-order adds from texts, photos (QR and visual search) and pending completions; and the assistants' «En el catálogo» line and customer link.
- A hidden product stays in: the seller's product list (marked «Oculto»), its product page and variants, «Nueva venta» on web and mobile, the point of sale, the order editor picker, printing and every existing order.
- Showing it again (switch off) returns it to the catalog and to message reading for every read after the save, with nothing else to redo.
- Everything goes into one slice, web and mobile together.

Meeting point with [message to order without silent losses](https://app.todoist.com/app/task/6hrq6p7vJHRmJcwV) (in progress on its own branch): that feature gives the reader up to 2 products that are no longer sold, name only, so a text naming one gets «Producto no disponible». Whatever question 1 decides, hidden products are handled in that same place and never as sellable candidates; this feature only adds them there.

## Out of this version

- Two separate switches (catalog only, chats only). Trigger: a seller asking to sell a product in chats but not in the catalog, or the reverse.
- A «Ocultos» filter in the product list, and hiding or showing several products at once. Trigger: stores with more than about 50 products asking for it; the «Oculto» mark and the search cover the usual case.
- Hiding a single variant. Not needed: deactivating a variant already exists ([Products](../products.md)).
- Archiving or deleting products (also out of «Nueva venta»). Trigger: its own task; hiding is not archiving.
- Scheduling visibility (hide until a date). Trigger: a seller asking for launches or pre-sales.
- Hiding from an AI assistant tool: the assistants are read-only.
- The pt-BR texts are written in implementation with the same meaning as the Spanish ones below.

## Flow

1. The seller opens a product (web `/products/:productId`; mobile Productos → the product).
2. She turns on «Ocultar producto». The form now has unsaved changes, like any other field.
3. She presses **Guardar cambios** (web) or **Guardar** (mobile). The save is the product's usual all-or-nothing save; the switch and the button are disabled while it reads «Guardando…».
4. On success the product page shows the usual saved confirmation and the switch stays on. Back in the list, the product carries «Oculto».
5. From that moment, a buyer loading the catalog no longer sees it; its link shows «Este producto ya no está disponible»; a cart that holds it refuses **Continuar** on that line; and messages read after the save never add it.
6. To show it again, the seller turns the switch off and saves.

Alternative paths:

- **Creating a hidden product:** the switch is on the create form too; the product is born hidden and never appears in the catalog.
- **Leaving with the switch changed and unsaved:** the usual «¿Descartar cambios?» applies; nothing is hidden.
- **Save rejected, not sent or in doubt:** the product's usual failure handling ([When something fails](#when-something-fails)); the switch keeps the seller's position on screen and the product keeps its stored visibility until a save succeeds.

## Screens

**Product form, web** (`/products/new` and `/products/:productId`):

- A row «Ocultar producto» with a switch, in the product's main data after «Fotos» and before the Variants card. Under it, always visible: «Si lo ocultas, no aparece en tu catálogo y Yoyos no lo agrega a pedidos desde los chats. Puedes seguir vendiéndolo en Nueva venta.»
- It is part of the form draft: it saves with **Guardar cambios**, counts as a change for the «¿Descartar cambios?» guard and for the browser's leave warning, and is restored by **Descartar**.
- While saving, it is disabled with the rest of the form.
- It is shown the same for products with and without options, and with or without active variants.

**Product form, mobile** (create screen and product screen):

- The same row, label and hint, as a native switch in the form's main fields, after the photo strip and before «Variantes». Touch target at least 44 pt; the accessible name is «Ocultar producto» and the state is announced as on or off.
- Saves with **Guardar**; same discard and disabled rules as web.

**Product list, web and mobile:**

- A hidden product shows the text mark «Oculto» next to its name, with an eye-off icon, never color alone. Its accessible name adds «oculto».
- Order, search, pages and states of the list do not change; a hidden product is found by name and SKU like any other.
- A hidden product without active variants shows both «Oculto» and «Sin variantes activas».

**Product page, web and mobile:** the switch itself shows the state; there is no extra banner.

**Public catalog (buyer):** no new screen. A hidden product is not in the grid, takes no slot of a page and is not found by search; its product page shows the existing «Este producto ya no está disponible» with **Volver al catálogo**, themed, with 404. A cart line of a hidden product shows the existing «Ya no está disponible» and **Continuar** shows «Algunos productos ya no están disponibles. Quítalos para continuar».

**«Apariencia de la tienda» preview:** the preview cards show only what the buyer would see, so hidden products are left out.

**«Nueva venta», point of sale and order editor picker:** a hidden product is offered exactly as a visible one, with no mark. Reason: in a seller-made sale visibility to buyers does not matter.

**AI assistants:** **Buscar productos** and **Ver producto** say «No está en el catálogo: oculto» for a hidden product and never give its customer link; `en_catalogo: "no"` includes hidden products. Since a hidden product can have active variants, `en_catalogo: "no"` combined with a variant filter is no longer refused: it matches hidden products with a matching active variant. A product both hidden and without active variants says «No está en el catálogo: oculto y sin variantes activas».

## Rules

| Aspect | Behavior |
| --- | --- |
| What hides | The whole product, all its variants. Visibility is per product, not per variant. |
| Default | Visible. Products that exist when this ships stay visible. |
| Who changes it | Any seller user of the company who can edit products, on web or mobile. |
| When it takes effect | For every read after the save commits: a new catalog page load, a cart refresh or **Continuar**, a message whose reading starts afterwards. A page or a message already being read is not interrupted. |
| Public catalog | «What is shown» becomes: active, visible products with at least one active variant, priced in the company's currency. A hidden product is not listed, not searchable and its URL answers «Este producto ya no está disponible» (404), the same answer as a product that does not exist, so a hidden product is not revealed. |
| Cart in the buyer's browser | The line stays in the cart; on refresh or **Continuar** it is marked «Ya no está disponible» and no order is created until the buyer removes it. Same rule as a deactivated variant. |
| Pending catalog order (created by **Continuar**, not yet confirmed) | Keeps working: the buyer can reopen it with **Continuar**, confirm and pay it. The seller settles it in the chat. Same rule as an order with a deactivated variant ([Products](../products.md)). |
| Shared product links | A link already sent (`https://rosa.yoyos.lat/productos/<id>`) shows «Este producto ya no está disponible» while hidden and works again when shown. |
| Orders already created | Never change: catalog, chat and manual orders that contain the product are shown, edited, paid, shipped and cancelled as before. Their checkout links keep working. |
| Message reading: adding | No message adds a hidden product: not by text, QR, visual search, caption or pending completion. Example: the buyer of chat order #1023 sends «quiero la casaca jean en M» and «Casaca jean» is hidden: nothing is added. What the seller is told depends on question 1. |
| Message reading: items already in the open order | An item of a hidden product added before it was hidden stays. The buyer can lower, remove or set its quantity («mejor que sean 1»). Raising it («uno más de la casaca») or changing its variant is an add to a hidden product: nothing changes. Same rule as an item of a product no longer sold. |
| Message reading: pendings | A pending of a product that becomes hidden ends when a message tries to complete it, as for a product no longer sold; it does not come back when the product is shown again. |
| Message reading: never a substitute | A hidden product is never replaced by a similar visible one: «casaca jean» never adds «Casaca denim». |
| Seller editing a chat order | The order editor picker and mobile editing offer hidden products. A hidden product the seller adds by hand to a chat order stays like any manual item; later messages can lower or remove it, not raise it. |
| «Nueva venta» and point of sale | Unchanged: hidden products are offered and their QR is read. |
| Stock, prices, variants | Hiding changes none of them. Stock is neither reserved nor released. |
| Photos | Hiding does not remove or reindex photos; a shown-again product is recognizable at once. |
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
| Success | The usual saved confirmation; the switch keeps the saved position; the list shows or drops «Oculto» | Nothing more |
| Known rejection (another field invalid) | Nothing is saved, the visibility included; the switch keeps her position; the error is next to its field | Fix the field and save again |
| Not sent (offline) | «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» with **Reintentar**; the form intact | Retry; nothing changed in the catalog |
| In doubt | The usual in-doubt text with **Recargar producto**; never «guardado». The catalog may or may not already hide it | Reload: the switch shows the stored visibility |
| Product changed by someone else | «Este producto cambió desde que lo abriste…» with **Recargar producto** (only when the structure changed) | Reload and set the switch again |
| Two devices change only the visibility | Last save wins, like prices and SKU | — |
| Seller leaves with the switch changed | «¿Descartar cambios?»; discarding keeps the stored visibility | Keep editing or discard |

The buyer's failures do not change: a catalog load error still shows **Reintentar**, never an empty catalog, and a failed cart refresh keeps its lines.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller user of the company | Every product, hidden or not, with its mark | Hide and show, sell hidden products manually | — |
| Buyer without an account | Visible products of a published catalog | Browse, cart, **Continuar** | Learn that a hidden product exists: its URL answers exactly like a missing product |
| Buyer writing in the chat | — | Ask for any product | Get a hidden product added by Yoyos |
| AI assistant connected by the owner | Every product, with «No está en el catálogo: oculto» | Read only | Give the customer link of a hidden product |

The risk the buyer-side rule closes: a hidden product reached by a guessed or old link must not be orderable or reveal that it is only hidden.

## Information that is kept

- Per product, account data: whether it is hidden. Only the current value; when or who hid it is not kept. Where it is stored is to be resolved in implementation.
- Orders keep their copies (name, combination, SKU, price) and are never affected by visibility.
- The buyer's cart keeps its lines in the browser, as today.
- Existing products receive «visible» without seller action; no transition period (no production data yet).

## Vocabulary

- **Oculto** («Ocultar producto», «Oculto»): a product the seller sells but does not offer to buyers in the catalog or let Yoyos add from chats. Not to be confused with a **hidden catalog** («Tu catálogo está oculto»), which hides the whole store, nor with a **deactivated variant** («Desactivada»), which is no longer sold anywhere. The interface never says «archivado» or «invisible» for it.

## Closed decisions

| Decision | Why |
| --- | --- |
| One switch covers the catalog and message reading | Both are buyer-initiated sales; the seller's reason to hide one almost always applies to the other. |
| Visibility is per product; variants keep their own active/inactive rule | Deactivating a variant already exists; hiding answers "do not offer this product". |
| Hidden products stay in «Nueva venta», the point of sale and the order editor | The goal is to keep selling it in person; otherwise it would be deactivation. |
| The switch saves with the product form, not on its own | One save model for the product page; the discard guard covers it. |
| A hidden product's URL answers like a missing product | The buyer cannot tell hidden from deleted. |
| Pending catalog orders and created orders with a hidden product keep working | Same rule as deactivated variants: what was already agreed is honored and settled in the chat. |
| A hidden product is never replaced by a similar visible one in message reading | Guessing another product is worse than adding nothing. |

## Acceptance criteria

1. The seller opens «Casaca jean» (2 variants, M and L, both active), turns on «Ocultar producto» and presses **Guardar cambios**: the list shows «Casaca jean» with «Oculto»; loading `https://rosa.yoyos.lat/` no longer shows it, searching «casaca» does not find it, and `https://rosa.yoyos.lat/productos/<id>` shows «Este producto ya no está disponible» with status 404.
2. A buyer had «Casaca jean · M» and «Polo básico · S» in the cart before it was hidden; pressing **Continuar** marks the jacket line «Ya no está disponible», shows «Algunos productos ya no están disponibles. Quítalos para continuar» and creates no order; after removing the line, **Continuar** creates the order with the polo only.
3. A buyer pressed **Continuar** with «Casaca jean · M» (pending catalog order #1050) before the product was hidden; reopening the cart and pressing **Continuar** returns order #1050 unchanged, and the buyer confirms and pays it.
4. The seller opens «Nueva venta» on mobile, searches «casaca» and adds «Casaca jean · L» while it is hidden; the sale is saved and its stock is deducted as usual.
5. With «Casaca jean» hidden, a buyer writes «quiero la casaca jean en M» in a chat with open order #1023: the order does not change and no other product is added in its place.
6. With «Casaca jean» hidden, a buyer sends a photo of its printed QR label: nothing is added to the chat order.
7. Order #1023 had «Casaca jean · M · ×2» before the product was hidden; the buyer writes «mejor que sea 1»: the item goes to 1. The buyer writes «una más de la casaca»: the item stays at 1.
8. The seller turns «Ocultar producto» off and saves: the jacket appears again in the catalog grid in its usual place (newest first by creation date), its old link opens the product page, and a later «quiero la casaca jean en M» adds it to the chat order.
9. The seller creates «Muestra polo» with «Ocultar producto» on: it never appears in the catalog and appears in «Nueva venta».
10. The seller turns the switch on and leaves the page without saving: «¿Descartar cambios?» appears; discarding leaves the product visible.
11. The seller turns the switch on with no connection on mobile and presses **Guardar**: «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» appears, the switch stays on screen, and the catalog still shows the product.
12. The save answer is lost: the form shows the in-doubt notice with **Recargar producto**, never a saved confirmation; reloading shows the switch in its stored position.
13. An AI assistant asks **Buscar productos** with `texto: "casaca"` while it is hidden: the product shows «No está en el catálogo: oculto» and no «Link para tu cliente».
14. The «Apariencia de la tienda» preview of a store with a hidden product does not show it among its cards.

## Open items and questions

Questions (answer with the option number):

1. When a buyer's message asks for a hidden product (names it, sends its QR label or a photo of it), what does the seller get?
   (1) Nothing is added and the seller gets a notice of its own, «Producto oculto»: «Un cliente pidió Casaca jean, que está oculta. Revisa el chat.». Hidden products are still identified (as name-only candidates for texts, and by QR and visual search for photos) only to say this. Recommended: the buyer asked for a real product the seller can still sell by hand, and a photo of a hidden product is never matched to a look-alike visible one. Adds one notice kind and joins the «Producto no disponible» path of the in-progress message-to-order task.
   (2) Hidden products do not exist for message reading: a text naming one is treated like a product not in the catalog and a photo like one that matched nothing («Producto no reconocido»), or matches a similar visible product above the 0.8 certainty. Less work; the seller gets a confusing «no reconocido», and a look-alike can be added. The mobile catalog hint also needs a new text for a store whose products are all hidden.
   (3) Same as (1) but reusing «Producto no disponible» and its text («…que ya no está a la venta…»). No new notice kind; the text is false for a product the seller still sells.

Decided unless objected:
- The switch is «Ocultar producto» (on = hidden), off by default, with the hint «Si lo ocultas, no aparece en tu catálogo y Yoyos no lo agrega a pedidos desde los chats. Puedes seguir vendiéndolo en Nueva venta.».
- It sits in the product's main data after the photos and before Variants, on web and mobile, on create and on edit.
- It saves with **Guardar cambios** / **Guardar**, not at once; unsaved changes to it trigger «¿Descartar cambios?».
- The list mark is the text «Oculto» with an eye-off icon; no list filter in this version.
- Hiding needs no confirmation and showing again restores everything at once.
- The cart and pending catalog orders follow the deactivated-variant rules: lines blocked at **Continuar**, an existing pending order can still be confirmed and paid.
- Hidden products are offered with no mark in «Nueva venta», the point of sale and the order editor picker, also when editing a chat order.
- Items of a hidden product already in a chat order can be lowered or removed by messages, never raised; pendings of it end on their next completion attempt and do not come back.
- The «Apariencia de la tienda» preview leaves hidden products out.
- The AI assistants say «No está en el catálogo: oculto», include hidden products in `en_catalogo: "no"` and never give their customer link.
- Products that exist when this ships stay visible; no transition.
