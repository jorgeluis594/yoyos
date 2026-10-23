# Checkout

The checkout is the public page where a buyer reviews an existing order, completes their details and delivery, confirms the purchase and pays, from a mobile browser without an account or app.

Code: `apps/core/src/features/orders/` (domain `checkout.ts`, application `checkout.ts`), `apps/core/app/routes/checkout.tsx`, contracts in `shared/contracts/order-checkout.ts`. Store appearance (logo and themes, shared with the public catalog): `apps/core/src/features/store-appearance/`, theme values in `shared/store-themes.ts`, contract in `shared/contracts/store-appearance.ts`, mobile editor in `apps/mobile/src/features/store-appearance/`.

## Business rules

### Link and access

- The seller enables the checkout of an order and gets its URL: `/checkout/:companyId/:orderId`. Enabling is done once; asking again returns the same URL. Reason: a shared link must keep working.
- The checkout lives on the app host (`app.yoyos.lat`); its URL is built from `BETTER_AUTH_URL`. The [public catalog](public-catalog.md) on a brand host (`{subdomain}.yoyos.lat`) sends the buyer there with **Continuar**, and the checkout's screens, steps and rules are the same for catalog orders.
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
- Confirming does not touch the catalog's cart, which lives on the brand host's origin. The catalog asks core whether its continued order was confirmed and empties the cart itself ([Public catalog · Buyer](public-catalog.md#buyer)).
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

Each company brands its store with a logo and one of five fixed themes: the store appearance, «Apariencia de la tienda». It belongs to the company, not to the seller or the order, and one appearance applies to both the checkout and the [public catalog](public-catalog.md#theme); there is no theme per surface. Reason: the store must look the same from the first product to the payment.

### What can be configured

| Element | Options |
| --- | --- |
| Logo | Upload, replace or remove. PNG, JPG or WEBP up to 10 MB and up to 8000 px per side and 24 megapixels, validated by content. No SVG, crop or positioning. |
| Theme («Tema») | Exactly one of **Clásico** (default), **Boutique**, **Antojo**, **Suave** and **Noche**. |

No value of a theme (color, background, accent, font, rounding) can be edited, and nothing else is configurable: no CSS, HTML, scripts, custom domains, per-surface or per-order settings. Reason: a closed set gives each business a distinct look while every option stays tested and accessible, and configuration can never break the buyer flow (rejected: free colors or per-company overrides).

The theme names are proper names, shown the same in every language. The interface always calls them «tema», never «estilo», «plantilla» or «diseño».

### Themes

- A theme is a closed set of colors, fonts, type sizes and weights, rounding, borders, shadows, spacing, logo plate, photo filter and product thumbnail shape. It changes styles only: the checkout's steps, fields, texts, validations and screen order are identical in all five, and the product thumbnail is the only content themes added. The catalog applies the same values over its own layout, except the field and button sizes, which stay the catalog's own ([public catalog](public-catalog.md#theme)).
- The five definitions live in code: `shared/store-themes.ts`, the single source of every theme value, read by core (the CSS variables of the checkout, the catalog and the editor preview) and by the mobile app (its static theme samples). Every color is an opaque HEX, so contrast is computable. Reason: contrast is verified in advance and no tone is computed at runtime, and both apps paint the same values. The contrast, completeness and font tests live in core (`apps/core/src/features/store-appearance/domain/store-themes.test.ts`), because the mobile typecheck covers `shared/` with Jest types only.
- Only the theme identifier is stored (`classic`, `boutique`, `antojo`, `suave`, `noche`), never its values. Reason: adjusting a theme applies to every company that uses it without migrating data.
- Adding, changing or removing a theme or one of its values is a reviewed code change, never a setting. A theme cannot inherit a value from another: each one defines every token.
- An unknown stored identifier makes the stored appearance unusable as a whole: checkout and catalog fall back to Clásico without logo, so both surfaces stay identical. The editor shows the same with a notice (see [Editing and publishing](#editing-and-publishing)).
- **Fixed mode:** Noche is always dark; Clásico, Boutique, Antojo and Suave are always light. Neither the buyer's system preference nor the stored panel preference changes them. Reason: the mode is part of each theme's identity and keeps one tested version per theme (rejected: light and dark versions of each theme). The fixed mode applies only to the themed buyer pages (checkout and catalog) and the editor preview; «Enlace no disponible», «Catálogo no disponible», the catalog's full-page load error, the seller panel and every other page keep following the system or stored preference.
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

Clásico is the default: a company that never saved an appearance is on Clásico without logo, in checkout and catalog. Reason: Clásico is neutral for any brand.

### Editing and publishing

- The web editor is «Apariencia de la tienda» in web settings (`settings/store-appearance`, plain and language-prefixed), in the panel menu. The old address `settings/checkout-appearance`, plain or language-prefixed, answers 308 to the new one with the same prefix and query. Reason: bookmarks and habits keep working. The mobile app has its own screen ([Mobile editor](#mobile-editor)). Any user who can manage the company's settings can edit it; no new role exists.
- Sections: **Logo**, **Tema**, **Restablecer apariencia** and the **Publicar catálogo** card, where the seller chooses the catalog link and publishes ([Public catalog · Publicar catálogo card](public-catalog.md#publicar-catálogo-card)). The card is drawn as its own surface, apart from Logo and Tema, and is reached at `#catalog-publication`. **Tema** is a single-choice list, «Temas de la tienda», of the five themes in the fixed order Clásico, Boutique, Antojo, Suave, Noche; each option shows a static sample painted with the theme's real values (page background, a card, the primary button and the thumbnail shape), its name, a one-line description and a check mark when selected. One theme is always selected; choosing the selected one again changes nothing. On the phone the editor has **Editar** and **Vista previa** tabs, with the publication card in **Editar**; touch targets are at least 44 px.
- The editor itself keeps the Yoyos identity; the selected theme is visible only in the samples and the preview.
- Logo and theme changes stay in a session draft and are previewed live with the «Cambios sin guardar» badge; nothing is published until **Guardar cambios**, which publishes logo and theme together as one unit («Apariencia actualizada»). The catalog link and the publication switch are outside the draft: the link saves with its own **Guardar link** and the switch at once. «Apariencia actualizada» never means the link was saved.
- **Descartar cambios** restores the published appearance. **Restablecer apariencia** prepares Clásico without logo in the draft, still requires saving, and never touches the publication. Leaving with unsaved logo or theme changes, or with an unsaved catalog link ([Public catalog · Saving, changing and failures](public-catalog.md#saving-changing-and-failures)), including reloading or closing the tab, asks «Tienes cambios sin guardar» with «Seguir editando» or «Descartar y salir». The description says what is pending: only logo or theme, «Si sales ahora, perderás los cambios que no publicaste.»; only the link, «Si sales ahora, no se guardará el link que escribiste.»; both, «Si sales ahora, perderás los cambios que no publicaste y el link que escribiste.». On reload or tab close the browser shows its own generic dialog. The publication switch never counts as an unsaved change, and an unsaved link never shows the badge or enables **Guardar cambios** or **Descartar**.
- **Independent loading:** the appearance (logo, theme, preview) and the publication card load and fail separately. An appearance read failure replaces Logo, Tema and preview with «No se pudo cargar la apariencia» and **Reintentar**, hides **Guardar cambios**, **Descartar** and **Restablecer apariencia**, and leaves the card working. **Reintentar** re-reads both parts without reloading the page and keeps the draft. A failure of the card's link check, save or re-read stays inside the card and never clears the draft or the typed link. Reason: the card is the only place to hide the catalog.
- **Unknown stored theme:** the editor shows exactly what buyers see, Clásico selected and no logo, with «No pudimos usar tu apariencia guardada. Tus clientes ven tu tienda con el tema Clásico y sin logo. Elige tu tema y tu logo y guarda.». It is never a load error. That starting point is not a draft: no badge, no **Descartar**, no **Restablecer apariencia**, and leaving untouched asks nothing; **Guardar cambios** is enabled, so saving as is stores Clásico without logo. After a change the usual draft applies, and **Descartar** returns to Clásico without logo with the notice still shown. The notice disappears after the first successful save. Reason: the editor shows only what buyers see, and a rare corrupt record must not nag the seller on every visit.
- **Other unusable stored data** (anything other than an unknown theme) stays a load error of Logo, Tema and preview, with the publication card working; buyers see Clásico without logo. It is an accepted limitation: very rare, since the database protects the logo reference, and the seller cannot change logo or theme until the data is fixed by hand.
- **Stored logo that cannot be shown:** if the stored logo's image cannot be resolved, the editor (web and mobile) loads with the stored theme and «Sin logo» with **Subir logo** and no **Quitar logo**; buyers see the stored theme without logo. A save that does not touch the logo keeps the stored logo; uploading a new one replaces it. Reason: a valid theme is not dropped over an image URL, and no client erases the logo.
- A save rejected for an unknown theme shows «Revisa el tema e inténtalo de nuevo.»; one rejected for an invalid logo shows «No pudimos usar ese logo. Súbelo de nuevo.». The draft is kept in both cases.
- A save that fails or gets no response shows «No pudimos guardar la apariencia. Conservamos tu borrador.» with **Reintentar**. The draft is kept, also when the editor's reload after the lost save fails too; the published appearance is whatever the server last completed. Repeating the save publishes the same logo and theme again, so it cannot duplicate or mix anything. A failed logo upload offers its own **Reintentar** and does not touch the theme.
- The web editor checks the byte limit before uploading; a server rejection for the logo's dimensions shows «El logo es demasiado grande. Usa una imagen de hasta 8000 px por lado.». The limits come from `imageUploadLimits` in `shared/contracts/images.ts`, read by the server, the web editor and the mobile app. Reason: no client checks a different number than the server.
- The last completed save wins, also between web and mobile; there is no versioning or optimistic lock. Reason: it is a complete visual configuration with nothing to merge.
- Uploading a logo does not publish it; a logo uploaded and never saved stays an orphan image. The logo must be a public image of the same company (enforced by a composite foreign key) and is visible to buyers.
- The company ID always comes from the session, never from the request body. A request that sends a brand color, a background or any unknown key is rejected.
- Code and logs use the name «store appearance»; the stored data keeps its table `CompanyCheckoutAppearance` and enum `CheckoutTheme`. Reason: one name per concept in code at no database cost (rejected: renaming the table, enum and RLS policy, a migration with an exclusive lock for no visible gain).

### Preview

- An iframe renders the real catalog and checkout components with the draft logo and theme. A selector **Catálogo** | **Checkout** (accessible name «Vista previa», touch targets of at least 44 px) chooses the surface; it opens on **Catálogo** every time the editor loads, because the catalog is what the buyer sees first. Switching keeps the draft and the device choice, and does not reload the iframe.
- One label names the active view: the theme and the origin of the data, «Tema Boutique · Tus productos» or «Tema Boutique · Datos de ejemplo». The checkout view always uses sample data.
- The phone/desktop switch applies to both views; the review/payment switch exists only in **Checkout**. There is no light/dark switch: each theme's mode is fixed, so the preview shows it as the buyer sees it. Reason for the iframe: it has its own viewport, so the real breakpoints apply without rewriting the pages.
- **Catálogo** view: a short catalog with header (logo plate and store name), search field, the first three products in the catalog's own order (only products the catalog would show) and the floating cart button.
  - The products are read once per editor visit, also while the catalog is hidden: it previews the look, not the publication. Saves, publication changes and **Reintentar** never re-read them.
  - While they load, the view shows the header and three empty card placeholders in the draft theme with «Cargando productos»; it never shows samples first and swaps them for real ones.
  - A company with one or two visible products sees only those; one with none, or whose products fail to load, sees three sample products. Real and sample products are never mixed. Reason: padding with samples would show the seller a store that is not theirs. A product-load failure never blocks the editor.
  - The cart button looks like the real one with one unit, «Carrito» with the badge «1» and no amount, standing for the first product shown that is not «Agotado»; if every product shown is sold out, it shows no units.
- **Checkout** view: sample order, buyer and amounts. The sample order has one product with a sample photo and one without, so both the thumbnail and the marker are visible. The payment state shows the company's real payment methods, or labeled examples if it has none or they cannot be read.
- The preview does not read the stored appearance: it stays blank until the editor sends the first draft, so an unknown or unusable stored appearance never breaks it. Only a failed company-name read fails it.
- It is inert: it never navigates, searches, adds to a cart, sends requests, creates orders or registers payments. The catalog view's search field, cards and cart button are out of the keyboard focus order and hidden from screen readers, which announce only the view's label. The iframe is sandboxed without form submission and messages are validated by origin and schema.

### Mobile editor

- Settings → «Apariencia de la tienda» («Logo, tema, link y publicación de tu catálogo»), between the delivery row and Catálogo. It is a single scrolling editor with no tabs; opened from Catálogo (`focus=catalog`) it scrolls to the **Publicar catálogo** card without opening the keyboard. It keeps the app's own look; the selected theme shows only in the samples.
- **Logo** on its white plate, or «Sin logo» (announced as «Logo de tu tienda» when present); **Subir logo** or **Cambiar** from the gallery or the camera; **Quitar logo**; «Subiendo logo…» while uploading.
- **Tema**: the five themes in the fixed order, with static samples painted with each theme's colors, rounding, button shape and thumbnail shape in the phone's system font, name, description and check mark; announced as the single-choice group «Temas de la tienda». The app bundles no theme fonts. Reason: no extra weight in the app for a sample.
- **Publicar catálogo**: the same card as on web, with the catalog link (saved with **Guardar link**) and the switch (saved at once). While the link field has focus, the field, its status line and **Guardar link** stay visible above the keyboard and the save bar.
- **Save bar**: only while logo or theme differ from the published ones, fixed at the bottom above the tab bar, with «Cambios sin guardar», **Descartar** and **Guardar cambios**. Uploading a logo with no other change shows no bar until the upload finishes. While a logo uploads, **Guardar cambios** is disabled; while saving, it reads «Guardando…» and the bar buttons, logo actions and theme list are disabled, but the publication switch stays usable. A successful save hides the bar and shows «Apariencia actualizada» under the screen description, announced politely; a failed save keeps the bar with the save error and **Reintentar**.
- Leaving the settings stack with unsaved logo or theme changes or an unsaved catalog link asks «Tienes cambios sin guardar» with **Seguir editando** / **Descartar y salir** and the same three descriptions as on web; switching tabs does not ask and keeps the draft. Same pattern as delivery settings.
- Loading, the unknown stored theme (the save bar shows only **Guardar cambios**) and an unresolved stored logo behave as on web.
- No live preview and no **Restablecer apariencia**: the seller gets the same result by choosing Clásico and removing the logo, and sees the result in **Ver catálogo** once the catalog is published. Accepted gap until phone-only sellers ask to see the theme before publishing.
- **Logo files.** The logo is never processed like a product photo, which is re-encoded as JPEG and would put a solid box behind a transparent logo on every buyer page.
  - PNG, JPG and WEBP are uploaded byte for byte with their own type: never re-encoded, resized or flattened, so a transparent logo reaches buyers as it would from web. The picker keeps the original file (no editing).
  - HEIC/HEIF gallery photos and camera photos are converted to JPG, scaled to at most 1024 px on the longest side and reduced in quality until they weigh 10 MB or less. Reason: the logo shows at header size on every buyer page, and a full-size camera JPG would make every buyer download several megabytes. **Reintentar** after a failed conversion or upload converts the chosen photo again.
  - Before uploading: any other format shows «Usa una imagen PNG, JPG o WEBP.»; a PNG, JPG or WEBP over 10 MB shows «El logo debe pesar hasta 10 MB.»; one over 8000 px per side or 24 megapixels shows «El logo es demasiado grande. Usa una imagen de hasta 8000 px por lado.». None is shrunk, so the logo is never altered. The server still validates by content.
  - Hint: «PNG, JPG o WEBP hasta 10 MB, o una foto de tu galería o cámara. Tus clientes verán este logo en tu catálogo y en tu checkout.»

### API

The mobile app reads and saves the appearance through `GET` and `PUT /api/store-appearance` (bearer token or session with an active company; the company and user come only from access). Request, response and error codes are defined in `shared/contracts/store-appearance.ts`; responses are `no-store`. The web editor uses its own loader and action instead.

- `GET` answers the readable appearance (theme and logo `{ id, url }`) or `unknown_theme`; Clásico without logo for a company that never saved one. Other unusable stored data answers `503 INVALID_STORED_DATA`.
- `PUT` takes `{ theme, logoImageId }` and answers the saved appearance, which mobile uses as its new baseline without reading again. An unknown theme, an unknown key or a bad id answers `400 INVALID_STORE_APPEARANCE`; malformed JSON `400 INVALID_INPUT`; a logo that is missing or of another company `422 INVALID_IMAGE`; a non-JSON body `415`. Rejections never change the published appearance.
- A logo whose URL cannot be built comes back as `url: null` with its id, so a theme-only save keeps it; a save that committed is never reported as failed because the URL could not be built afterwards.
- The logo is uploaded with the existing `POST /api/images`; the catalog link and publication use the catalog settings API ([Public catalog · Data and API](public-catalog.md#data-and-api)). Saving the appearance, the link and the publication never change each other.

### Buyer view

- The theme applies to the whole checkout in every state: pending, delivery choice, confirmed with payment instructions and receipt upload, cancelled, and the total-changed and rate-error notices. The catalog's themed screens are listed in [Public catalog · Theme](public-catalog.md#theme).
- The appearance is read only after the order access is authorized; «Enlace no disponible» keeps the unbranded Yoyos look and follows the buyer's system preference.
- Opening or reloading a link shows the latest published theme and logo, including links shared before and historical orders; no per-order or per-cart copy is kept.
- Without a saved appearance, or if reading it fails, the checkout uses Clásico without logo and the order can still be confirmed and paid. Reason: a visual failure must never block a sale.
- The theme styles are scoped to the themed subtree of the checkout or catalog (and the page background behind it) and never change the private panel. The catalog's cart sheet renders inside that subtree so it keeps the theme. The active theme's styles are generated in the browser from `shared/store-themes.ts`, the same mechanism the editor preview needs for drafts; it adds a few KB to the buyer bundle, accepted to keep one mechanism for every surface.

## Observability

Logging follows [logging conventions](logging.md).

- The full checkout URL is a credential: raw URLs are never logged. Routes are normalized to `/checkout/:companyId/:orderId` and `/api/orders/:orderId/checkout-link`; New Relic obfuscates UUIDs in URLs and excludes the `orderId` attribute (`apps/core/newrelic.cjs`).
- Buyer data, request bodies, payment data and amounts are never logged.
- `http_request_completed` carries a closed `operation` (`enable_checkout`, `get_checkout`, `confirm_checkout`) and `outcome`. Expected rejections (invalid input, total changed, cancelled, already confirmed, unavailable) do not emit `warn` or `error`.
- `order_checkout_enabled` and `order_checkout_confirmed` are emitted only for the first transition and only after the transaction commits. Reason: a rolled-back write must not look like a success.
- Each technical failure has a single log owner; upper layers propagate the `Result` without logging it again.
- A save of the store appearance (web or mobile) logs `store_appearance_saved` with the theme, whether there is a logo, whether the appearance is the default and, with a logo, its image id. Joined with `image_uploaded` (images module: type, bytes and dimensions), it shows how heavy the logos buyers download are.
- Checkout and catalog requests are tagged with `storeAppearance: default | custom | fallback` and `storeTheme` (`classic` … `noche`). In the checkout, a failed appearance read logs `order_store_appearance_failed`; in the catalog, `unable_to_read_catalog` with `operation: read_appearance`. Both fall back to Clásico without logo.
- The store appearance repository logs `invalid_stored_store_appearance` (`errorCode` `UNKNOWN_STORED_THEME` or `INVALID_STORED_DATA`, with field names only), `unable_to_load_store_appearance` and `unable_to_save_store_appearance`. A logo URL that cannot be built for the seller read or the save logs `store_logo_url_unavailable` (warn); the buyer read does not log it, so a storage outage adds no warning per buyer request.
- The mobile API logs `store_appearance_response_invalid` when its own response fails the contract and `store_appearance_request_failed` for an unexpected failure. Its request operations are `get_store_appearance` and `save_store_appearance`; a `415` is answered before any operation is bound.
- Editor request operations: `get_store_appearance`, `save_store_appearance`, `set_catalog_publication`, `get_store_preview` and `get_catalog_preview_cards`; the link group adds `get_catalog_settings`, `check_catalog_subdomain` and `save_catalog_subdomain`. A failed preview-card read logs `unable_to_read_catalog` (`read_preview_store` or `read_preview_cards`).
- A failed photo lookup for the checkout logs `order_checkout_photos_unavailable` (orders, with the variant count) and, when the variant query itself fails, `unable_to_read_variant_photos` (products infrastructure); photos whose image cannot be resolved are reported by the existing `product_list_images_unavailable`. The checkout still loads with markers. Photo and logo URLs are never logged.
