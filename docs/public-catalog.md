# Public catalog

Each company can publish one public catalog at `/catalogo/:companyId`. A buyer without an account opens the link (usually from Instagram or WhatsApp), browses the company's products, builds a cart and taps **Continuar**: core creates an order and hands the buyer to the existing [checkout](checkout.md). The seller receives the order once the buyer confirms it there.

Code: `apps/core/src/features/catalog/` (publication, browsing, continue to checkout), catalog read models in `apps/core/src/features/products/`, catalog orders in `apps/core/src/features/orders/`, web routes `apps/core/app/routes/catalog*.tsx`, mobile settings in `apps/mobile/src/features/catalog/`. Settings contract: `shared/contracts/catalog.ts`.

## Scope

- One catalog per company with a fixed layout defined by Yoyos. The seller configures nothing except publishing it. Reason: zero configuration for the seller; personalization would be added over the same layout.
- The catalog uses the company's [checkout appearance](checkout.md#appearance) (logo, brand color, background), so the catalog and checkout look like the same store.
- The public pages are web only (React Router loaders and actions). There is no public JSON API.
- The link uses the company's internal id, not a readable slug. Reason: nothing to configure or validate. The link never changes, also across hide and publish.

## Seller

- Settings → Catalog, on web and mobile: switch **Publicar catálogo**, the link with **Copiar link**, **Ver catálogo**, and on mobile **Compartir** (system share sheet). Hiding asks for confirmation. A failed save returns the switch to its previous position.
- API: `GET` and `PUT /api/catalog/settings` (seller session).
- Existing companies start with the catalog off.
- Catalog orders show «Desde el catálogo» in the seller's order list and detail, on web and mobile, and have no seller user.

## Buyer

- **Catalog page:** store header, product grid (newest first, 24 per page, **Ver más**), search by product name. A product shows «Desde» the minimum price when variants differ and «Agotado» when every variant is out of stock; a product without photo shows a neutral block with its initial. Search, loaded pages and scroll position are kept when returning from a product.
- **Product page:** photo, name, price, description, one selector per attribute. Combinations that do not exist and variants without stock cannot be selected. Quantity from 1 up to the variant's available stock, never above 99.
- **Cart:** lives only in the buyer's browser (`localStorage`); it is not sent to Yoyos before **Continuar**. Reason: the buyer has no account and an abandoned cart needs no storage. One line per variant, at most 30 lines. It shows «Subtotal de productos»; «Total» is reserved for the checkout, where delivery is added. It is emptied when the buyer confirms the checkout.
- An unknown company, a malformed link and a company with the catalog off all show the same «Catálogo no disponible». Reason: an unpublished catalog must not reveal that the company exists.
- A load failure shows an error with **Reintentar**, never an empty catalog.

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
