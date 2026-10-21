# Checkout

The checkout is the public page where a buyer reviews an existing order, completes their details and delivery, confirms the purchase and pays, from a mobile browser without an account or app.

Code: `apps/core/src/features/orders/` (domain `checkout.ts`, application `checkout.ts`), `apps/core/app/routes/checkout.tsx`, contracts in `shared/contracts/order-checkout.ts`. Appearance and themes: `apps/core/src/features/checkout-appearance/`.

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

### Delivery choice

- «Forma de entrega» offers, in this order and only when available: «Conservar entrega actual» (only with a saved delivery), «Entrega a domicilio», «Envío a agencia» and «Recojo en tienda · Gratis». A saved delivery is preselected; otherwise the first available method.
- «Envío a agencia» appears only when the method is on and the company has agency coverage ([Delivery](delivery.md#delivery-methods)). The public checkout receives coverage as a yes/no flag only, decided when the checkout loads; zones, districts and agencies are never exposed. Reason: the buyer only needs to know whether the method exists.
- Home and agency quote the buyer's district with the [current quotation](delivery.md#quotation). «Entrega a domicilio» lists only home rates; «Envío a agencia» has no rate list: the buyer picks a destination agency and its rate follows from it.
- The agencies offered are only those of the agency rates of the buyer's district. Their price is the option's, never the agency's location. Reason: coverage and price are per zone; a district whose zones have no agency option sees no agencies, even with agencies nearby.
- An agency in several options is shown once with the lowest price; on equal price, the option whose name sorts first. Reason: the buyer picks a place, not an option.
- **Location cascade:** one list with the first level that has agencies, by the agency's location: the buyer's district, else their province, else their department. A notice names the level used when it is the province or department. Levels are never mixed and agencies outside the buyer's department are never shown. Reason: shows the nearest agencies without maps or geolocation.
- Within the level, agencies are ordered by price, agency name, then courier name. Each entry shows agency, courier, address, district, province and price. A single agency is preselected.
- Without agencies at any level the buyer sees a message with **Cambiar distrito** and, when home delivery is offered, **Pasar a Entrega a domicilio**.
- Changing department, province or district clears the agency and rate and quotes again. Changing method clears rate, agency and quotation but keeps the district.
- The agency delivery cost is shown with the chosen agency, in each destination entry and in the summary's «Entrega» row, never on the «Envío a agencia» option itself, since it depends on the agency. No delivery lead time is shown for any method. Reason: Yoyos records no lead time, and adding one would change the delivery settings on web and mobile.
- On a phone, in every theme, labels sit above their fields and the total is visible before the payment action.
- Agency delivery requires the recipient's identity document. The server revalidates option and agency on confirmation; the cascade and its level are not stored.

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

The public response contains the store name, order number, products, quantities, sale prices, `itemsTotal`, `total`, delivery, the buyer's available details and the checkout state. Each product carries `imageUrl`, the public URL of its product's current photo or `null` (see [Product thumbnails](#product-thumbnails)). It never includes internal costs, contact, seller or variant IDs, or payment records. Product photos are already public images (the catalog shows them), so the photo adds no internal data; the buyer only sees the photos of the products in that order.

The orders module offers two reads of the same projection: `orders.getCheckout`, used by the checkout page, which adds the item photos, and `orders.getCheckoutView`, without photos, used by the delivery quotation endpoint when it authorizes a quote by order link. Reason: a quotation never renders photos, so it does not pay for their lookup or log their failure.

## Appearance

Each company brands its checkout with a logo and one of five fixed themes. The appearance belongs to the company, not to the seller or the order.

### What can be configured

| Element | Options |
| --- | --- |
| Logo | Upload, replace or remove. PNG, JPG or WEBP up to 10 MB, validated by content. No SVG, crop or positioning. |
| Theme («Tema») | Exactly one of **Clásico** (default), **Boutique**, **Antojo**, **Suave** and **Noche**. |

No value of a theme (color, background, accent, font, rounding) can be edited, and nothing else is configurable: no CSS, HTML, scripts, custom domains or per-order settings. Reason: a closed set gives each business a distinct look while every option stays tested and accessible, and configuration can never break the buyer flow (rejected: free colors or per-company overrides).

The theme names are proper names, shown the same in every language. The interface always calls them «tema», never «estilo», «plantilla» or «diseño».

### Themes

- A theme is a closed set of colors, fonts, type sizes and weights, rounding, borders, shadows, spacing, logo plate and product thumbnail shape. It changes styles only: the checkout's steps, fields, texts, validations and screen order are identical in all five, and the product thumbnail is the only content themes added.
- The five definitions live in code: `apps/core/src/features/checkout-appearance/domain/checkout-themes.ts`, the single source of every theme value. Every color is an opaque HEX, so contrast is computable. Reason: contrast is verified in advance and no tone is computed at runtime.
- Only the theme identifier is stored (`classic`, `boutique`, `antojo`, `suave`, `noche`), never its values. Reason: adjusting a theme applies to every company that uses it without migrating data.
- Adding, changing or removing a theme or one of its values is a reviewed code change, never a setting. A theme cannot inherit a value from another: each one defines every token.
- An unknown stored identifier is invalid data; the checkout falls back to Clásico.
- **Fixed mode:** Noche is always dark; Clásico, Boutique, Antojo and Suave are always light. Neither the buyer's system preference nor the stored panel preference changes them. Reason: the mode is part of each theme's identity and keeps one tested version per theme (rejected: light and dark versions of each theme). The fixed mode applies only to the themed buyer checkout and the editor preview; «Enlace no disponible», the seller panel and every other page keep following the system or stored preference.
- **Fonts:** Clásico uses the system sans. Boutique: Playfair Display for headings, Inter for the body. Antojo: Fredoka for headings, Nunito for the body. Suave: Outfit. Noche: Inter. All are free and self-hosted by Yoyos, and the browser downloads only the fonts the active theme renders. If a font fails to load, the text uses the theme's fallback system font with the same layout. Reason: no external provider or cost, and no weight from unused fonts on the buyer's phone.
- **Serif only for display text in Boutique:** headings, the store name, product names and the «Total a pagar» label use the heading font; field labels, typed values, buttons, prices and every amount (including the total amount) use the sans body font. Reason: serif harms the reading of data and numbers on a phone.
- **Antojo's primary button** is coral with dark brown text. Reason: white on coral reaches only 3.1:1; dark brown keeps the coral identity above 4.5:1.
- **Semantic colors** (errors, warnings, success, information, payment states, destructive actions) keep their meaning and icons in every theme, in tones that meet the contrast floor on that theme (dark-surface tones on Noche). «Gratis» uses the theme's own free color.
- **Payment images and QR codes** keep their original colors and sit on a white plate in every theme, so a QR stays scannable on Noche. Receipts are text links.

### Contrast floor

- In all five themes: text at least 4.5:1 against its surface (background, every stop of Suave's gradient, cards, fields, selected options); borders of fields and controls, the selected option, radio dots, invalid-field borders and the keyboard focus at least 3:1 against card, background and field surface. Decorative borders, separators and shadows only need to be visible.
- The payment method chips' own border is decorative in Boutique and Noche: each chip holds a radio whose border passes 3:1, and the selected chip adds its outline. In the other themes the chip border is a control border.
- A unit test checks every pair for every theme.
- When an approved reference value failed the floor, the floor won: only that value moved, keeping hue and chroma (OKLCH) and changing lightness until it passed. Each adjusted value carries its original in a comment in the themes file. Reason: keeps each approved look while meeting the floor, with no large-text exception for buttons.

### Logo presentation

- The logo is always shown whole: never cropped, distorted or recolored. It sits on a white plate in every theme, so dark, light and transparent logos read the same way, including on Noche. Reason: a logo that cannot be read defeats the purpose of branding.
- Each theme sets the plate's size, rounding, border, shadow and placement: Clásico and Noche at the start with 8 px rounding; Boutique centered above the store name with square corners; Antojo at the start on a pill plate with a hard shadow; Suave centered on a pill plate with a soft shadow. A pill plate is a circle for a square logo and a capsule for a horizontal one, so a long logo is never cut. A long horizontal logo may widen its plate up to 20rem so it can fill the plate's height; on a phone the plate leaves about 6rem beside it for the store name (Boutique, where the name sits below, may use the full width). Reason: an 8:1 wordmark capped at the square logo's width is legible only at about 8 px. In themes with a centered header, the brand is centered within the page width.
- Without a logo, or when it fails to load, the store name alone identifies the business; no initials mark is invented.

### Product thumbnails

- Each product row of the checkout shows, at the left, a thumbnail of the product's current photo, then name, variant, quantity by price and subtotal. Size and shape per theme: Clásico 56 px square, Boutique 56 px at 4:5, Antojo 76 px square, Suave 64 px square, Noche 48 px square, with the theme's rounding, border and photo filter.
- The photo is the current photo of the item's product (one per product, see [Products](products.md)), resolved through the item's variant whatever the product or variant status. It is not copied into the order: replacing the photo changes it in open links, next to the product name the order keeps. Reason: the photo is presentation, not part of what was agreed.
- A product without photo, a deleted variant, or a photo that fails to load shows a neutral block of the same size and shape with the first letter of the product name saved in the order, in capitals («Polo básico» → «P»); never a broken image.
- The thumbnail is decorative: the name next to it identifies the product, so it adds nothing for screen readers.
- If the photos cannot be read, the checkout loads with markers in every row. Reason: photos are decorative and must never block a sale.

### Default

Clásico is the default: a company that never saved an appearance is on Clásico without logo. Reason: Clásico is neutral for any brand.

### Editing and publishing

- The editor is in web settings (`settings/checkout-appearance`), with no mobile app editor. Any user who can manage the company's settings can edit it; no new role exists.
- Sections: **Logo**, **Tema** and **Restablecer apariencia**. **Tema** is a single-choice list of the five themes in the fixed order Clásico, Boutique, Antojo, Suave, Noche; each option shows a static sample painted with the theme's real values (page background, a card, the primary button and the thumbnail shape), its name, a one-line description and a check mark when selected. One theme is always selected; choosing the selected one again changes nothing. On the phone the editor has **Editar** and **Vista previa** tabs; touch targets are at least 44 px.
- The editor itself keeps the Yoyos identity; the selected theme is visible only in the samples and the preview.
- Changes stay in a session draft and are previewed live with the «Cambios sin guardar» badge; nothing is published until **Guardar cambios**, which publishes logo and theme together as one unit («Apariencia actualizada»).
- **Descartar cambios** restores the published appearance. **Restablecer apariencia** prepares Clásico without logo in the draft and still requires saving. Leaving with unsaved changes, including reloading or closing the tab, asks «Seguir editando» or «Descartar y salir».
- A save rejected for an unknown theme shows «Revisa el tema e inténtalo de nuevo.»; one rejected for an invalid logo shows «No pudimos usar ese logo. Súbelo de nuevo.». The draft is kept in both cases.
- A save that fails or gets no response shows «No pudimos guardar la apariencia. Conservamos tu borrador.» with **Reintentar**. The draft is kept, also when the editor's reload after the lost save fails too; the published appearance is whatever the server last completed. Repeating the save publishes the same logo and theme again, so it cannot duplicate or mix anything. A failed logo upload offers its own **Reintentar** and does not touch the theme.
- The last completed save wins; there is no versioning or optimistic lock. Reason: it is a complete visual configuration with nothing to merge.
- Uploading a logo does not publish it. The logo must be a public image of the same company (enforced by a composite foreign key) and is visible to buyers.
- The company ID always comes from the session, never from the request body. A request that sends a brand color, a background or any unknown key is rejected.

### Preview

- An iframe renders the real checkout components with sample order, buyer and amounts, labeled "Vista previa · Datos de ejemplo". The sample order has one product with a sample photo and one without, so both the thumbnail and the marker are visible. The payment state shows the company's real payment methods, or labeled examples if it has none.
- It switches between phone and desktop, and between review and payment. There is no light/dark switch: each theme's mode is fixed, so the preview shows it as the buyer sees it. Reason for the iframe: it has its own viewport, so the real breakpoints apply without rewriting the checkout.
- It never sends requests, creates orders or registers payments; the iframe is sandboxed without form submission and messages are validated by origin and schema.

### Buyer view

- The theme applies to the whole checkout in every state: pending, delivery choice, confirmed with payment instructions and receipt upload, cancelled, and the total-changed and rate-error notices.
- The appearance is read only after the order access is authorized; «Enlace no disponible» keeps the unbranded Yoyos look and follows the buyer's system preference.
- Opening or reloading a link shows the latest published theme and logo, including links shared before and historical orders; no per-order copy is kept.
- Without a saved appearance, or if reading it fails, the checkout uses Clásico without logo and the order can still be confirmed and paid. Reason: a visual failure must never block a sale.
- The theme styles are scoped to the checkout subtree (and the page background behind it) and never change the private panel.

## Observability

Logging follows [logging conventions](logging.md).

- The full checkout URL is a credential: raw URLs are never logged. Routes are normalized to `/checkout/:companyId/:orderId` and `/api/orders/:orderId/checkout-link`; New Relic obfuscates UUIDs in URLs and excludes the `orderId` attribute (`apps/core/newrelic.cjs`).
- Buyer data, request bodies, payment data and amounts are never logged.
- `http_request_completed` carries a closed `operation` (`enable_checkout`, `get_checkout`, `confirm_checkout`) and `outcome`. Expected rejections (invalid input, total changed, cancelled, already confirmed, unavailable) do not emit `warn` or `error`.
- `order_checkout_enabled` and `order_checkout_confirmed` are emitted only for the first transition and only after the transaction commits. Reason: a rolled-back write must not look like a success.
- Each technical failure has a single log owner; upper layers propagate the `Result` without logging it again.
- The appearance editor logs `checkout_appearance_saved` with the theme, whether there is a logo and whether the appearance is the default. The checkout request is tagged with `checkoutAppearance: default | custom | fallback` and `checkoutTheme` (`classic` … `noche`).
- A failed photo lookup for the checkout logs `order_checkout_photos_unavailable` (orders, with the variant count) and, when the variant query itself fails, `unable_to_read_variant_photos` (products infrastructure); photos whose image cannot be resolved are reported by the existing `product_list_images_unavailable`. The checkout still loads with markers. Photo and logo URLs are never logged.
