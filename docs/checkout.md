# Checkout

The checkout is the public page where a buyer reviews an existing order, completes their details and delivery, confirms the purchase and pays, from a mobile browser without an account or app.

Code: `apps/core/src/features/orders/` (domain `checkout.ts`, application `checkout.ts`), `apps/core/app/routes/checkout.tsx`, contracts in `shared/contracts/order-checkout.ts`. Brand appearance: `apps/core/src/features/checkout-appearance/`.

## Business rules

### Link and access

- The seller enables the checkout of an order and gets its URL: `/checkout/:companyId/:orderId`. Enabling is done once; asking again returns the same URL. Reason: a shared link must keep working.
- Orders created from the public catalog have the checkout enabled at creation; other orders start without it. The seller enables it from the order detail (web) or with `POST /api/orders/:orderId/checkout-link` (mobile).
- A cancelled order cannot be enabled.
- The link does not expire and is not closed by payment, shipping or delivery. Reason: confirming and paying are independent actions; closing by shipping was rejected.
- The URL is the access credential. Both IDs are random UUIDs; the visible order number is never used to resolve access. No signed token, extra key or link table is used. Reason: two UUIDs are unguessable and avoid extra state (rejected: `/checkout/:token`).
- The company in the URL only scopes the public operation; it never grants access to private routes. Tenant isolation (RLS) still applies: the server sets the company context, then checks that the order belongs to it and has the checkout enabled.
- An invalid, unknown or not-enabled link shows the same message, "Enlace no disponible", without revealing whether the order exists.
- Responses are sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and the page is `noindex`.
- `/pago/:orderId` does not exist. Reason: it resolved access with the order UUID alone; every buyer goes through the checkout.

### Checkout states

The state is derived from `Order.checkoutEnabledAt`, `Order.checkoutConfirmedAt` and cancellation; no separate status column is stored. A confirmation date requires an enabled date.

| State | Behavior |
| --- | --- |
| Not enabled | No public access. Not shown to the seller as "pending confirmation". |
| Pending | Shows products and amounts; the buyer can complete or correct their details and delivery, then confirm. |
| Confirmed | Read-only details; shows payment instructions and receipt upload. Repeating the confirmation returns the existing result without overwriting anything. |
| Cancelled | Takes precedence over the other states without clearing their dates; confirmation is blocked. |

### Confirmation

- Requires a non-empty name and a phone in international format. No surnames or minimum word count are required.
- Products and quantities are set by the seller; the buyer cannot edit them. To change products, the order is cancelled and a new one is created.
- The buyer either keeps the current delivery or replaces it with one of the delivery methods the company has enabled; the server resolves its price from the company's delivery settings (`apps/core/src/features/delivery-settings/`) and rejects it if the price the buyer saw changed.
- The buyer sends the total they saw (`expectedTotal`). It is compared with the current total under the order lock; if it differs, nothing is saved, the form keeps its values and the new total is shown for a new confirmation. Reason: the buyer never confirms an amount they did not see; the sent value is never used as a price.
- Buyer, delivery change and confirmation date are saved in one transaction that locks the order. Concurrent confirmations are serialized; only the first one writes.
- Confirming expresses purchase intent. It does not register a payment.
- The buyer is stored in `OrderBuyer`, a per-order copy (see `apps/core/prisma/schema.prisma`). Editing it never updates the global Contact. `contactId` comes from the server, never from the public form.

### Amounts

- The checkout shows `itemsTotal` (products) and `total` (what the buyer pays, including delivery). It never recalculates the total in the browser nor labels the subtotal as total.
- Other modules update the authoritative order total; payments change the balance, not the total.

### Payment

- Payment is only available once the checkout is confirmed and the order is not cancelled. The buyer payment API (`/api/buyer/orders/:orderId/...`) rejects orders that are not enabled, pending or cancelled.
- The company's configured payment methods are shown (digital wallet and bank transfer), with the payment image the company uploaded.
- "Ya pagué" requires a JPG, PNG or WEBP receipt up to 10 MB. The report is idempotent on retry and stays pending review; only the seller's confirmation records the amount received.

### Order number

- Every order gets `Order.number`: a per-company sequence starting at 1001, shown as `Pedido #1001`. It continues past 9999 without fixed width, is permanent and is not reused after cancellation.
- It is allocated by atomically incrementing `Company.nextOrderNumber` in the same transaction that creates the order, and `(companyId, number)` is unique. Reason: `MAX + 1` or counting orders races under concurrency.

### Public projection

The public response contains the store name, order number, products, quantities, sale prices, `itemsTotal`, `total`, delivery, the buyer's available details and the checkout state. It never includes internal costs, contact or seller IDs, or payment records.

## Appearance

Each company can brand its checkout with a logo, a brand color and a background. The appearance belongs to the company, not to the seller or the order.

### What can be configured

| Element | Options |
| --- | --- |
| Logo | Upload, replace or remove. PNG, JPG or WEBP up to 10 MB, validated by content. No SVG, crop or positioning. |
| Brand color | One of a closed catalog of nine colors. No HEX input, spectrum picker or eyedropper. |
| Background | White, Neutral or Brand (the soft background of the chosen color). |

Everything else is fixed: structure, typography, texts, fields, validations and order. No CSS, HTML, scripts, custom domains or per-order settings. Reason: every option is accessible by construction and the buyer flow cannot be broken by configuration.

### Color catalog

- The catalog lives in code: `apps/core/src/features/checkout-appearance/domain/checkout-colors.ts`. Each color defines all its tokens for light and dark mode. Reason: contrast is verified in advance for every color, so no tone is computed at runtime (rejected: free HEX with derived tones).
- Only the color identifier is stored, not its tones. Reason: adjusting a color applies to every company that uses it without migrating data.
- Adding, changing or removing a color is a reviewed code change, never a setting. Every color must meet WCAG contrast: 4.5:1 for normal text, 3:1 for large text and controls.
- An unknown stored identifier is invalid data; the checkout falls back to the default appearance.
- The brand color only applies to primary actions, links and selections. Semantic colors (errors, success, payment states), cards and fields keep the system colors. QR codes, receipts and payment images keep their original colors.
- Dark mode follows the buyer's preference. White and Neutral map to the dark system background; Brand uses the dark brand background of the color.

### Editing and publishing

- The editor is in web settings (`settings/checkout-appearance`). Any user who can manage the company's settings can edit it; no new role exists.
- Changes stay in a session draft and are previewed live; nothing is published until **Guardar cambios**, which publishes logo, color and background together as one unit.
- **Descartar cambios** restores the published appearance. **Restablecer apariencia** prepares the default in the draft and still requires saving. Leaving with unsaved changes asks to keep editing or discard.
- A failed upload or save keeps the draft and the published appearance.
- The last completed save wins; there is no versioning or optimistic lock. Reason: it is a complete visual configuration with nothing to merge.
- Uploading a logo does not publish it. The logo must be a public image of the same company (enforced by a composite foreign key) and is visible to buyers.
- The company ID always comes from the session, never from the request body.

### Preview

- An iframe renders the real checkout components with sample order, buyer and amounts, labeled "Vista previa · Datos de ejemplo". The payment state shows the company's real payment methods, or labeled examples if it has none.
- It switches between phone and desktop, light and dark, and review and payment. Reason for the iframe: it has its own viewport, so the real breakpoints apply without rewriting the checkout.
- It never sends requests, creates orders or registers payments; the iframe is sandboxed without form submission and messages are validated by origin and schema.

### Buyer view

- The appearance is read only after the order access is authorized; an invalid link shows the generic error without branding.
- Opening or reloading a link shows the latest published appearance, including links shared before. Historical orders use the current appearance; no per-order copy is kept.
- Without a saved appearance, or if reading it fails, the default Yoyos appearance is used and the order can still be confirmed and paid. Reason: a visual failure must never block a sale.
- If the logo fails to load, the company name identifies the business.
- The brand styles are scoped to the checkout and never change the private panel.

## Observability

Logging follows [logging conventions](logging.md).

- The full checkout URL is a credential: raw URLs are never logged. Routes are normalized to `/checkout/:companyId/:orderId` and `/api/orders/:orderId/checkout-link`; New Relic obfuscates UUIDs in URLs and excludes the `orderId` attribute (`apps/core/newrelic.cjs`).
- Buyer data, request bodies, payment data and amounts are never logged.
- `http_request_completed` carries a closed `operation` (`enable_checkout`, `get_checkout`, `confirm_checkout`) and `outcome`. Expected rejections (invalid input, total changed, cancelled, already confirmed, unavailable) do not emit `warn` or `error`.
- `order_checkout_enabled` and `order_checkout_confirmed` are emitted only for the first transition and only after the transaction commits. Reason: a rolled-back write must not look like a success.
- Each technical failure has a single log owner; upper layers propagate the `Result` without logging it again.
- The appearance editor logs `checkout_appearance_saved`; the checkout request is tagged with `checkoutAppearance: default | custom | fallback`.
