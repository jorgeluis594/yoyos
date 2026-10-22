# Public catalog

Each company can publish one public catalog at `/catalogo/:companyId`. A buyer without an account opens the link (usually from Instagram or WhatsApp), browses the company's products, builds a cart and taps **Continuar**: core creates an order and hands the buyer to the existing [checkout](checkout.md). The seller receives the order once the buyer confirms it there.

Code: `apps/core/src/features/catalog/` (publication, browsing, continue to checkout), catalog read models in `apps/core/src/features/products/`, catalog orders in `apps/core/src/features/orders/`, web routes `apps/core/app/routes/catalog*.tsx`, mobile settings in `apps/mobile/src/features/catalog/`. Settings contract: `shared/contracts/catalog.ts`. Theme and logo: the [store appearance](checkout.md#appearance) (`apps/core/src/features/store-appearance/`).

## Scope

- One catalog per company with a fixed layout defined by Yoyos. The seller configures nothing except publishing it and the [store appearance](checkout.md#appearance) (logo and theme) it shares with the checkout. Reason: zero configuration for the seller; personalization is applied over the same layout.
- The catalog uses the company's store theme and logo, the same ones as the checkout (see [Theme](#theme)). Reason: the store must look the same from the first product to the payment, so the buyer never wonders at the handoff whether they are still in the same shop (rejected: a theme per surface, or the default Yoyos look in the catalog).
- The public pages are web only (React Router loaders and actions). There is no public JSON API.
- The link uses the company's internal id, not a readable slug. Reason: nothing to configure or validate. The link never changes, also across hide and publish.

## Seller

- **Publishing** lives in «Apariencia de la tienda», on web and mobile ([Checkout · Editing and publishing](checkout.md#editing-and-publishing)): the **Publicar catálogo** card with the switch and «Este cambio se guarda al momento.». It saves at once, outside the logo and theme draft: **Descartar**, **Guardar cambios** and the leave confirmation ignore it. Hiding asks for confirmation («¿Ocultar tu catálogo?»). A failed save returns the switch to its previous position with «No pudimos guardar el cambio» and **Reintentar**, which resends the same value without asking again. Reason: publishing belongs with the store's look, in one place to set up how the store looks and whether it is open.
- The publication card loads and works independently of the appearance: if logo and theme cannot be read, the seller can still publish or hide the catalog, and a failed publication read shows «No pudimos cargar la configuración del catálogo» with **Reintentar** only inside the card. Reason: it is the only place to hide the catalog, and a failing logo or theme read must never stop the seller from closing the store.
- **Sharing** stays in Settings → Catálogo, on web and mobile: while the catalog is published, the link with **Copiar link**, **Ver catálogo** and, on mobile, **Compartir** (system share sheet), followed by «Para ocultar tu catálogo, ve a Apariencia de la tienda.»; while hidden, no link and «Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.». Both states offer **Ir a Apariencia de la tienda**, which opens that screen on top of Catálogo. Reason: sharing the link is a separate daily action, and a seller looking for the switch where it used to be must find where it went.
- On mobile, Catálogo re-reads the publication state every time the seller returns to it, keeping the last known state meanwhile, so it never offers **Compartir** for a catalog it knows is hidden.
- API: `GET` and `PUT /api/catalog/settings` (seller session, used by mobile). On web, publication is saved through the «Apariencia de la tienda» editor's action.
- Existing companies start with the catalog off.
- Catalog orders show «Desde el catálogo» in the seller's order list and detail, on web and mobile, and have no seller user.

## Buyer

- **Catalog page:** store header, product grid (newest first, 24 per page, **Ver más**), search by product name. A product shows «Desde» the minimum price when variants differ and «Agotado» when every variant is out of stock; a product without photo shows a neutral block with its initial. Search, loaded pages and scroll position are kept when returning from a product.
- **Product page:** photo, name, price, description, one selector per attribute. Combinations that do not exist and variants without stock cannot be selected. Quantity from 1 up to the variant's available stock, never above 99.
- **Cart:** lives only in the buyer's browser (`localStorage`); it is not sent to Yoyos before **Continuar**. Reason: the buyer has no account and an abandoned cart needs no storage. One line per variant, at most 30 lines. It shows «Subtotal de productos»; «Total» is reserved for the checkout, where delivery is added. It is emptied when the buyer confirms the checkout.
- A product that no longer exists or is no longer shown, inside a published catalog, shows «Este producto ya no está disponible» with **Volver al catálogo**, in the store theme with the store name, and answers 404.
- An unknown company, a malformed link and a company with the catalog off all show the same «Catálogo no disponible». Reason: an unpublished catalog must not reveal that the company exists.
- A load failure shows an error with **Reintentar**, never an empty catalog.

## Theme

The catalog renders the company's [store appearance](checkout.md#appearance): one of the five themes and the logo, exactly the values the checkout uses for that theme, through the same theme scope. There is no second theming mechanism and nothing in the catalog is configurable on its own.

- **Only styles change.** Colors, fonts, type sizes and weights, rounding, borders, shadows, spacing of the header and cards, logo plate, photo filter and cart thumbnail shape. The catalog controls (search field, buttons, quantity control, cart lines) keep the height, padding and spacing they had before themes in all five themes; the checkout's field and button sizes do not reach them. Screens, order, texts, fields, rules and flow are identical in the five themes. Reason: the themes are already tested and accessible.
- **Themed screens:** header (logo on the theme's plate and store name in the heading font, as in the checkout header), search field, «Cargando productos», product grid and cards, «Ver más», the empty and no-results messages, product page, «Este producto ya no está disponible», and the cart (floating button as the theme's primary button, sheet, lines, «Producto quitado» with **Deshacer**, rejected-line notices, «Subtotal de productos» and **Continuar**). Reason: they are every screen the buyer goes through before the checkout.
- **Not themed:** «Catálogo no disponible» and the full-page load error keep the unbranded Yoyos look and follow the buyer's system preference. Reason: the first must not reveal whether a company exists, and the second appears before Yoyos knows whether the company exists and has its catalog published, so both look the same for every link. «Este producto ya no está disponible» is themed because it happens inside a known published catalog, so theming reveals nothing.
- **Fixed scheme:** every themed screen uses the theme's fixed mode (Noche always dark; Clásico, Boutique, Antojo and Suave always light) from the first paint, whatever the buyer's system preference, as in the checkout.
- **Card photos** stay square in every theme, as before themes, with no rounding of their own: the card's rounding clips their top corners, so Suave never shows a round card photo. Card text keeps a small inset from the card edge only in themes that draw a card frame (a border, a shadow, or a card color different from the page); in frameless themes text aligns with the photo. Reason: it is what the approved mockup shows, and a 4:5 or round card photo would crop clothing photos and change the grid.
- **Cart thumbnails** take the theme's thumbnail shape, rounding and photo filter, as in the checkout, with the product's initial when the photo is missing.
- **Photo filter:** applied to card photos and cart thumbnails, never to the product page photo. Reason: the product page photo is where the buyer judges color and variant, so it shows the colors as uploaded (rejected: no filter anywhere, which departs from the approved mockup and the checkout thumbnails).
- **Product page photo:** today's shape with the theme's card rounding and border, never the thumbnail's (Suave 16 px); it is never a circle in any theme. Reason: the large photo must show the whole product.
- **Contrast floor:** the [checkout floor](checkout.md#contrast-floor) applies to every catalog element in the five themes. «Agotado» uses an opaque warning surface with warning text instead of a translucent badge over the photo, so its contrast is computable per theme. The search field always draws a border in the control color (3:1), also in themes whose fields have no border (Boutique, Noche).
- **Fonts:** the buyer's browser downloads only the fonts of the active theme; if one fails, the theme's fallback system font keeps the layout.
- **Fallback:** a company that never saved an appearance, an unknown stored theme, invalid stored data or a failed read all render Clásico without logo; the catalog is never hidden and the buyer can browse and continue. A stored logo whose image cannot be resolved shows the stored theme without logo. Reason: same rule as the checkout, so both surfaces stay identical, and a visual failure never blocks a sale.
- **When a change shows:** every load reads the latest published theme and logo. A buyer with the catalog open sees a change on the next page load; the cart in their browser is untouched.

## Rules

| Aspect | Rule |
| --- | --- |
| What is shown | Active products with at least one active variant, priced in the company's currency. Name, photo, description, attributes and sale price. Never purchase price, SKU, stock quantity or QR. |
| Search | Product name only, contains the typed text, case and accent insensitive, 2 to 80 characters. |
| Prices | The order is created with the prices current at **Continuar**, without comparing them with what the cart showed. Reason: same rule as every order; the checkout shows the real total before confirming. |
| Stock | Checked at **Continuar** to reject unavailable lines; not reserved and not deducted by the catalog. Reason: same stock rule as every order; two buyers may order the last unit and the seller resolves it in the chat. |
| Rejected cart | If a line is sold out, short of stock or no longer available, no order is created, the cart stays intact and each line shows its issue. A rejected cart consumes no order number. |
| Catalog order | Created with a visible number, checkout enabled, no buyer, no seller and no delivery. |
| Pending catalog order | A catalog order the buyer has not confirmed in the checkout. It is invisible to the seller: lists, detail and every seller action treat it as non-existent. Reason: before confirming it has no name or phone, and abandoned carts must not fill the seller's list. |
| Repeating **Continuar** | The browser derives the order id from the cart; the same cart opens the same order, a changed cart creates a new one. Reason: a retry after a lost response never duplicates the order. |
| Changing products | Done in the cart before continuing again, which creates a new order. The checkout does not allow product changes. |
| Expiry | Pending catalog orders without payments are deleted 7 days after creation (`CATALOG_ORDER_TTL_DAYS`) by a daily worker job at 04:00 `America/Lima`. Their numbers are not reused, so the seller may see gaps. An order being confirmed is never deleted. |
| Catalog turned off | The link shows «Catálogo no disponible» and an open cart cannot continue; orders already created keep their checkout links. |
| Abuse | **Continuar** is limited per client IP (20 per 10 minutes, `CATALOG_ORDER_RATE_LIMIT`). The limit is kept in process memory. |
| Privacy | Pages send `Referrer-Policy: no-referrer` and `noindex`; the order id is never logged because the checkout URL works as a credential. |

## Decisions

| Decision | Reason |
| --- | --- |
| The catalog creates a normal order and hands over to the existing checkout | Buyer data, delivery and payment already work there; nothing is duplicated, and checkout improvements apply to catalog orders. |
| Pending state derived from "from catalog and not confirmed", no new order state | Confirmation already exists; a draft state would touch every order flow. |
| Order number allocated at creation | The checkout shows the number from the start and confirmation stays unchanged. |
| Every active product appears; no per-product visibility | Zero configuration for the seller. |
| No WhatsApp contact button | The checkout does not configure a WhatsApp contact either. |
| No notification to the seller of a new catalog order | Yoyos has no notifications; the checkout has none either. |
| One store theme for catalog and checkout, no theme per surface | The store must look the same from the first product to the payment. |
| «Publicar catálogo» lives in «Apariencia de la tienda»; the link stays in Settings → Catálogo | Publishing belongs with the store's look; sharing is a separate daily action. |
