# Public catalog: product definition

**Status:** definition ready to implement. 16/10/2026. There is no public catalog, store or company slug today. The buyer only reaches Yoyos through the checkout link of an order the seller already created ([Checkout by link](checkout-por-link.md)). This document covers the path from choosing products to arriving at that same checkout; the checkout, delivery, payment and [checkout appearance](apariencia-del-checkout.md) rules stay as they are. No Todoist task yet.

## Problem and situation

A buyer sees a post on Instagram and writes «¿qué tienen en talla M?». The seller answers with photos one by one, writes prices by hand, and builds the order in Yoyos while the buyer waits. At night, with ten chats open, the seller forgets who asked for the black one and who asked for the beige one. Product information already lives in Yoyos (name, photo, variants, price, stock), but the buyer cannot see it, so every question goes through the chat and every order is typed by the seller.

## Goal

The buyer opens one link from the bio or the chat, finds products, builds a cart and arrives at the existing checkout with the order already assembled. The seller receives confirmed orders without typing them.

Hypothesis: if it works, part of the orders appear without the seller creating them. It would show in the share of confirmed orders that originate in the catalog, and in fewer orders the seller builds by hand per week.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Buyer who opened the catalog link from Instagram or WhatsApp, usually inside the app's browser, without an account | See what is for sale, price and availability, and order without asking in the chat | Public catalog in the mobile browser (desktop works with the same layout) |
| Seller publishing the catalog once and sharing its link many times | Turn the catalog on, copy the link, see the orders that arrive | Web: Settings → Catalog. Mobile: Settings → Catalog |
| Seller reviewing orders | Know which orders came from the catalog | Existing order list and detail, web and mobile |

## First-version scope

- One catalog per business, with one fixed layout defined by Yoyos. The seller does not configure layout, sections, texts, order, or which fields are shown.
- The catalog uses the business's existing checkout appearance (logo, brand color, background), so the catalog and the checkout look like the same store. No new appearance options.
- Product list with photo, name and price; search by product name.
- Product detail with description, variant selection and quantity.
- Cart in the buyer's browser: add, change quantity, remove.
- **Continue** creates the order and opens the existing checkout for that order. Buyer data, delivery, confirmation and payment happen there, without changes.
- Seller turns the catalog on and off and copies its link, on web and mobile.
- Orders from the catalog are marked «Desde el catálogo» in the seller's list and detail.
- Peru, soles, the business's time zone, as the rest of Yoyos.

Meeting points with other features:
- Checkout: the catalog only creates the order and hands over its link; the checkout does not know about the catalog. Any future improvement to the checkout applies to catalog orders with no extra work.
- Catalog personalization (sections, featured products, custom texts) adds over this same layout when it is defined.

## Out of this version

| Deferred | Trigger |
| --- | --- |
| Layout, sections, banners, featured products or texts chosen by the seller | When the fixed catalog shows which customizations sellers ask for |
| Readable address (`yoyos.pe/mi-tienda`) | When sellers ask for a link they can read or say aloud; the link with the business identifier keeps working |
| Filters by category, price or size; sorting chosen by the buyer | When catalogs with more than 100 products appear |
| Search by description, SKU or variant attribute | When search by name proves insufficient |
| Several photos per product | When products support more than one image |
| Hiding single products from the catalog | When a seller needs to sell a product in person but not in the catalog |
| Notifying the seller of a new catalog order | When notifications are defined for Yoyos; today the checkout has none |
| Coupons, discounts, minimum order amount | When discounts exist for orders |
| Stock reservation while the cart is open | Not planned; stock is deducted on payment, as today |
| A WhatsApp button «Pedir por chat» | Contradicts the closed checkout decision of not configuring a WhatsApp contact; only reopened with a new reason |

## Flow

Seller, once:
1. Settings → Catalog. The screen shows the catalog off and a preview with the business's real products.
2. Turns on **Publicar catálogo**. The screen shows the link and **Copiar link**.
3. Pastes the link in the Instagram bio or sends it in a chat.

Buyer, usual path:
1. Opens the link. Sees the store header (logo and name) and the products, newest first.
2. Types in **Buscar productos**; the list filters by name.
3. Taps a product. The detail shows photo, name, price, description, variant options and quantity (1 by default). If the product has a single variant, there is nothing to choose.
4. **Agregar al carrito**. The notice «Agregado al carrito» appears and the cart button shows the unit count.
5. Repeats 2–4 as needed. The search and the list position are kept on returning from a detail.
6. Opens **Carrito**: lines with photo, name, variant, quantity, unit price, line subtotal, and the products subtotal. Changes quantities or removes lines.
7. **Continuar**. Yoyos creates the order with current prices and opens its checkout: `Pedido #1042`.
8. In the checkout, as today: name, phone, delivery, **Confirmar pedido**, then payment instructions and «Ya pagué».
9. On confirmation, the cart in that browser is emptied.

Seller, after:
1. Sees `Pedido #1042` in the order list as «Confirmado por el comprador», with «Desde el catálogo».
2. Continues managing it as any other order: delivery quote, payment confirmation, dispatch.

Alternative paths:
- A product ran out or stopped existing between adding it and **Continuar**: the order is not created; the cart is shown with that line marked and the remedy (see When something fails).
- The buyer leaves the checkout without confirming and returns to the catalog: the cart is still there. **Continuar** with the same cart opens the same order; with a changed cart, Yoyos creates a new order. The unconfirmed one stays invisible to the seller.
- The buyer closes the browser with items in the cart and opens the link again from the same browser: the cart is still there.

## Screens

**Catálogo (buyer):**
- Header: logo and business name, as in the checkout. Fixed **Carrito** button with the unit count, reachable with the thumb.
- **Buscar productos** field at the top. Searches by name, ignoring upper/lower case and accents: «polo» finds «Polo básico» and «POLO OVERSIZE».
- Product grid: two columns on mobile, four on desktop. Each card: photo, name (two lines maximum), price. Without photo, a neutral block with the product's initial; never a broken image icon.
- Price on the card: if all variants cost the same, «S/ 45.00»; if not, «Desde S/ 39.90».
- Products where every variant is out of stock show «Agotado» over the photo.
- 24 products per page with **Ver más** at the end (initial value, adjustable).
- States:
  - Loading: card placeholders.
  - Catalog off, link of another business, or malformed link: «Catálogo no disponible». Same text for all three.
  - Catalog on without products: «Esta tienda todavía no tiene productos publicados».
  - No results: «No encontramos productos con "polo rojo"», with **Borrar búsqueda**.
  - Load error: «No pudimos cargar el catálogo. Revisa tu conexión», with **Reintentar**. Never shown as an empty catalog.
- On returning from a product detail: search, loaded pages and scroll position are kept.

**Producto (buyer):**
- Photo, name, price, description.
- One selector per attribute, with the values the seller defined: «Talla: S · M · L», «Color: Negro · Beige». The price updates with the chosen variant.
- Combination that does not exist: not selectable. Variant without stock: shown as «Agotado» and not selectable.
- Quantity stepper from 1 up to the available stock of the variant, and never above 99.
- Main action **Agregar al carrito**, disabled until a variant is chosen when there is more than one. If the variant is already in the cart, the quantity is added to the same line.
- Errors: product no longer available when opening: «Este producto ya no está disponible», with **Volver al catálogo**.

**Carrito (buyer):**
- Lines: photo, name, variant («Talla M · Negro»), quantity stepper, unit price, subtotal; **Quitar** per line. Removing does not ask for confirmation; the notice «Producto quitado» offers **Deshacer** for 5 seconds.
- «Subtotal de productos: S/ 129.80». Below: «El envío se calcula en el siguiente paso». The word «Total» is not used here.
- Main action **Continuar**, disabled with an empty cart or while a request is in progress.
- Empty: «Tu carrito está vacío», with **Ver productos**.
- Maximum 30 lines (initial value, adjustable). At the limit, **Agregar al carrito** shows «Tu carrito ya tiene 30 productos distintos».

**Catálogo (seller), Settings → Catalog, web and mobile:**
- Switch **Publicar catálogo** with «Cualquier persona con el link podrá ver tus productos y hacer pedidos».
- When on: the link complete in a read-only field and **Copiar link**; notice «Link copiado». On mobile, **Compartir** opens the system share sheet.
- **Ver catálogo** opens the public catalog in a new tab or the browser.
- Turning off asks for confirmation: «¿Ocultar tu catálogo? Quienes abran el link verán que no está disponible. Los pedidos ya hechos no cambian», with **Ocultar catálogo** and **Mantener publicado**.
- Turning on again keeps the same link.
- Load error: «No pudimos cargar la configuración del catálogo», with **Reintentar**.

**Order list and detail (seller), web and mobile:** add «Desde el catálogo» next to the order number. Nothing else changes.

## Rules

| Aspect | Behavior |
| --- | --- |
| What the catalog shows | Active products of the business with at least one active variant. Name, photo, description, attributes and sale price. Never purchase price, SKU, stock quantity, internal codes or QR. |
| Stock shown | Only «Agotado» or nothing. The exact quantity is never shown. |
| Order of products | Newest first, as in the seller's product list. |
| Search | Product name, case and accent insensitive, contains the typed text. Starts with 2 characters. |
| Prices | The catalog and cart show the price current when loaded. On **Continuar**, Yoyos creates the order with the price current at that moment, as in every order. The checkout shows the real total before confirming, so the buyer never confirms a price they did not see. |
| Currency | Soles. Assumption: every product of a business uses the business's currency; a product in another currency is not shown. |
| Quantities | Whole units, from 1 to 99 per line, and not above available stock when adding. One line per variant. |
| Stock | It is not reserved by the cart nor by creating the order. It is deducted when the order is paid, as today. Two buyers can order the last unit; the seller resolves it in the chat, as with orders from chat. |
| Order created by the catalog | Pending checkout confirmation, with checkout enabled, no buyer, no seller, no delivery, products and prices from the cart. It receives a visible number like any order. |
| Unconfirmed catalog orders | Deleted automatically one week after they were created. Their number is not reused, so the seller may see gaps in the sequence. If the buyer continues again with the same cart, the order is created again with a new number. |
| Visibility to the seller | The order appears in the seller's list and counts only once the buyer confirms it in the checkout. |
| Repeating **Continuar** | Same cart (same lines and quantities) from the same browser opens the same order, without creating another. A changed cart creates a new order. |
| Changing products after **Continuar** | Done from the catalog: the buyer edits the cart and continues again, which creates a new order. The checkout keeps not allowing product changes. |
| After confirming | The cart in that browser is emptied. Any change is requested from the seller through the chat, as in every checkout. |
| Catalog turned off | The link shows «Catálogo no disponible». Orders already created keep their checkout links working. An open cart cannot continue. |
| Product edited by the seller | The catalog shows the change on the next load. Orders already created keep their lines, as today. |
| Business time zone | Not used by the catalog; dates belong to the order. |

## States

The catalog has two states for the seller:

| State | Meaning | What triggers it | What the buyer sees |
| --- | --- | --- | --- |
| Off | Nobody can see it | Initial state; **Ocultar catálogo** | «Catálogo no disponible» |
| Published | Anyone with the link can see and order | **Publicar catálogo** | The catalog |

Transitions: Off → Published → Off, as many times as needed; the link does not change. Existing businesses start Off.

The cart has no states; it is a list in the buyer's browser. Catalog orders use the existing order and checkout states without new ones.

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| **Continuar** succeeds | The checkout of `Pedido #1042` | Continue in the checkout |
| The buyer opens the checkout of an unconfirmed order deleted after one week | «Enlace no disponible», as any unavailable checkout | Return to the catalog and **Continuar** again |
| A variant ran out before **Continuar** (known rejection) | The cart, intact, with the line marked «Se agotó» and the message «Algunos productos ya no están disponibles. Quítalos para continuar». No order is created | **Quitar** the line and **Continuar** |
| A quantity exceeds available stock (known rejection) | The line marked «Solo quedan 2», cart intact | Adjust the quantity and continue |
| A product was deleted or stopped being active (known rejection) | The line marked «Ya no está disponible», cart intact | **Quitar** and continue |
| The catalog was turned off meanwhile (known rejection) | «Esta tienda ya no está recibiendo pedidos por el catálogo». Cart intact | Write to the store by the chat |
| **Continuar** without connection (not sent) | «No pudimos continuar. Revisa tu conexión», cart intact | **Reintentar** |
| **Continuar** sent and no response (in doubt) | «No sabemos si tu pedido se creó. Vuelve a intentar: no se duplicará», cart intact | **Reintentar** opens the same order if it was created, or creates it once |
| Add to cart | Local to the browser; it cannot fail by network | — |
| Seller turns on, off, or copies the link | Success: «Catálogo publicado», «Catálogo oculto», «Link copiado». Failure: «No pudimos guardar el cambio», switch returns to its previous position | **Reintentar** |
| Buyer abandons in the cart and returns days later | Cart as left. Lines whose product ran out or changed price are corrected on **Continuar**, as above; prices on screen refresh on load | Continue |

While **Continuar** is in progress, the button is disabled and shows progress; a second tap does nothing.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Anyone with the catalog link | Business name and logo, published products with sale price, variants and «Agotado» | Search, build a cart, create an order and open its checkout | See stock quantities, purchase prices, SKUs, other orders, buyer data, or any private seller route |
| Buyer of a created order | That order's checkout, as today | What the checkout allows | Change products in the checkout |
| Seller | Their catalog setting and link, every confirmed catalog order | Publish, hide, copy and share the link | See carts in progress |

Risks and the protection for each:
- Someone fills the seller's list with fake orders: unconfirmed orders are not visible, and confirming requires name and valid phone, as today. On top, order creation from one origin is limited in frequency (value to be resolved in implementation).
- Someone guesses another business's catalog: catalogs are meant to be public; a link of a business with the catalog off shows the same «Catálogo no disponible» as a non-existent one.
- Knowing the catalog link does not open any order: each order keeps its own checkout link.

## Information that is kept

| Information | Where and until when |
| --- | --- |
| Catalog published or off | Business setting, until the seller changes it |
| Cart | Only in the buyer's browser, until they confirm the checkout or empty it. Not sent to Yoyos before **Continuar**. Another browser or phone does not see it |
| Products, variants and prices in the order | Copied into the order on **Continuar** and fixed, as in every order |
| Unconfirmed catalog orders | One week from creation, then deleted |
| Origin «Desde el catálogo» | Part of the order, permanent |
| Search and scroll position | Only while the page is open |
| Orders created before this feature | No origin; they do not show «Desde el catálogo» |

There are no product changes: the catalog reads the existing products.

## Vocabulary

- Catalog: the public page of the business with its products, «Catálogo». In the seller's interface «Catálogo» means only this page; the seller's product list keeps being «Productos».
- Cart: the products the buyer chose before continuing, «Carrito». It exists only in the buyer's browser.
- Continue: the action that turns the cart into an order, **Continuar**. Not «Comprar» nor «Pagar»: nothing is paid nor confirmed yet.
- Products subtotal: what the cart shows, «Subtotal de productos». «Total» is reserved for the checkout, where delivery is included.

## Closed decisions

| Decision | Why |
| --- | --- |
| One fixed layout for every business, no personalization | MVP scope given by the founder |
| The catalog reuses the existing checkout appearance | It is the store's identity already configured; it is not new personalization |
| The catalog creates an order and hands over to the existing checkout | Buyer data, delivery and payment already work there; nothing is duplicated |
| The checkout keeps not allowing product changes | Closed checkout decision; products are changed in the cart before continuing |
| Prices come from Yoyos when creating the order, without comparing with what the cart showed | Closed decision for every order; the checkout shows the real total before confirming |
| No stock reservation; deducted on payment | Current stock rule of orders |
| The cart lives only in the buyer's browser | The buyer has no account; nothing of an abandoned cart needs to be stored |
| No WhatsApp button or contact configuration | Closed checkout decision |
| The catalog link uses the business's internal identifier, without a readable address | Nothing to configure or validate; a readable address adds over it later |
| The seller sees a catalog order only once the buyer confirms it in the checkout | Before that it has no name or phone; abandoned carts do not fill the list |
| Every active product appears; no per-product visibility | Zero configuration for the seller |
| Variants without stock show «Agotado» and cannot be added | The buyer sees the product exists; the seller does not receive orders they cannot fulfil |

## Acceptance criteria

1. The seller of «Moda Lucía» turns on **Publicar catálogo** on the web and copies the link; on mobile, Settings → Catalog shows it on with the same link.
2. A buyer opens the link without an account, on a 390 px wide screen, and sees «Moda Lucía» with its logo and its products, newest first, 24 per page with **Ver más**.
3. The buyer types «polo» and sees «Polo básico» and «POLO OVERSIZE» but not «Casaca negra»; typing «polo rojo» with no match shows «No encontramos productos con "polo rojo"» and **Borrar búsqueda**.
4. The buyer opens «Polo básico», returns, and the search «polo» and scroll position are still there.
5. «Polo básico» has M/Negro at S/ 45.00 with stock 3 and L/Negro at S/ 49.00 with stock 0: the card shows «Desde S/ 45.00»; in the detail L/Negro shows «Agotado» and is not selectable; the quantity of M/Negro does not go above 3.
6. The buyer adds 2 × M/Negro and then 1 × M/Negro: the cart has one line with quantity 3 and «Subtotal de productos: S/ 135.00».
7. The buyer taps **Continuar**: `Pedido #1042` is created with those lines at S/ 45.00 and the checkout opens. Neither the stock quantity, SKU nor purchase price appear anywhere in the catalog or cart.
8. Before the buyer confirms, `Pedido #1042` does not appear in the seller's order list on web or mobile. After **Confirmar pedido**, it appears as «Confirmado por el comprador» with «Desde el catálogo», and the buyer's cart is empty.
9. The buyer taps **Continuar**, goes back without confirming and taps **Continuar** again with the same cart: the same `Pedido #1042` opens. They change a quantity and continue: a new order is created and only the confirmed one is visible to the seller.
10. Between adding and continuing, the seller's other sale leaves M/Negro with stock 1: **Continuar** does not create an order, the line shows «Solo queda 1» and the rest of the cart is intact.
11. The seller changes the price of M/Negro to S/ 50.00 while the cart shows S/ 45.00: the order is created at S/ 50.00 and the checkout shows that total before confirming.
12. The connection drops after **Continuar** is sent: the buyer sees «No sabemos si tu pedido se creó…»; **Reintentar** opens the single order created, never two.
13. The seller hides the catalog with a buyer's cart open: on **Continuar** the buyer sees «Esta tienda ya no está recibiendo pedidos por el catálogo»; an already created order's checkout link keeps working; on publishing again, the link is the same.
14. A malformed link, a link of a business with the catalog off, and a non-existent business all show «Catálogo no disponible».
15. A product without photo shows the block with its initial; a business with the catalog on and no products shows «Esta tienda todavía no tiene productos publicados».
16. Without connection when loading, the buyer sees «No pudimos cargar el catálogo. Revisa tu conexión» and **Reintentar**, never an empty catalog.
17. The buyer closes the browser with 2 lines in the cart and opens the link again from the same browser: both lines are there with current prices.

